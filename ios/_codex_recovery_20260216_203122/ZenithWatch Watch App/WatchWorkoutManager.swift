import Combine
import CoreLocation
import Foundation
import HealthKit
import WatchConnectivity

enum ZenithHealthAuthState: String {
  case unknown
  case notDetermined
  case denied
  case authorized
}

final class WatchWorkoutManager: NSObject, ObservableObject {
  @Published var snapshot: ZenithWatchSessionSnapshot?
  @Published var errorMessage: String?
  @Published var needsRecovery: Bool = false
  @Published var healthAuthState: ZenithHealthAuthState = .unknown
  @Published var startInProgress: Bool = false
  @Published var startInProgressLabel: String = ""
  // Truth-first recovery: if we only loaded a persisted snapshot and did not reattach to a live
  // HKWorkoutSession/HKLiveWorkoutBuilder, controls must be disabled to avoid phantom sessions.
  @Published var recoveryIsVerified: Bool = true
  @Published var setUndoUntilEpochMs: Int64? = nil

  private let healthStore = HKHealthStore()
  private var workoutSession: HKWorkoutSession?
  private var workoutBuilder: HKLiveWorkoutBuilder?
  private var workoutRouteBuilder: HKWorkoutRouteBuilder?

  private var locationManager: CLLocationManager?
  private var lastLocation: CLLocation?
  private var routeLocations: [CLLocation] = []

  private let metersPerMile: Double = 1609.344
  private let treadmillCalibrationKey = "zenith_treadmill_calibration_factor_v1"
  private let treadmillCalibrationUpdatedAtKey = "zenith_treadmill_calibration_updated_at_v1"
  private var treadmillCalibrationFactor: Double = 1.0
  private var treadmillCalibrationUpdatedAtUtc: String = ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: 0))
  private var treadmillFactorUsedThisSession: Double = 1.0
  private var lastDistanceMeters: Double?
  private var lastDistanceSampleAt: Date?
  private var recentSpeedSamplesMps: [Double] = []
  private var smoothedSpeedMps: Double?

  private var tickTimer: Timer?
  private var snapshotPersistTimer: Timer?
  private var startTimeoutWorkItem: DispatchWorkItem?
  private var startAttemptId: String? = nil
  private var startAttemptedKind: ZenithWorkoutKind? = nil

  private var startDate: Date?
  private var pauseStartDate: Date?
  private var pausedTotalSec: Int = 0
  private var seq: Int = 0

  private let snapshotKey = "zenith_watch_active_snapshot_v1"

  // HR truthfulness: only report HR availability if we actually observe HR from the live builder.
  private var hrSumBpm: Double = 0
  private var hrSampleCount: Int = 0
  private var hrMaxBpm: Double = 0

  override init() {
    super.init()
    treadmillCalibrationFactor = Self.loadTreadmillCalibrationFactor(from: treadmillCalibrationKey)
    treadmillCalibrationUpdatedAtUtc = UserDefaults.standard.string(forKey: treadmillCalibrationUpdatedAtKey)
      ?? ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: 0))
    startWatchConnectivity()
    refreshHealthAuthorizationStatus()
    loadRecoverySnapshot()
  }

  var isHealthAuthorized: Bool { healthAuthState == .authorized }

  func refreshHealthAuthorizationStatus() {
    // On watchOS, `isHealthDataAvailable()` can be false in some early/edge runtime states.
    // Do not treat that as a permanent denial; fall back to `unknown` and let the user retry.
    guard HKHealthStore.isHealthDataAvailable() else {
      DispatchQueue.main.async { self.healthAuthState = .unknown }
      return
    }
    let status = healthStore.authorizationStatus(for: HKObjectType.workoutType())
    let mapped: ZenithHealthAuthState
    switch status {
    case .notDetermined:
      mapped = .notDetermined
    case .sharingDenied:
      mapped = .denied
    case .sharingAuthorized:
      mapped = .authorized
    @unknown default:
      mapped = .unknown
    }
    DispatchQueue.main.async { self.healthAuthState = mapped }
  }

  func checkPermissionsAgain() {
    sendPermissionsPingToPhone()
    requestAuthorizationIfNeeded(needsRoute: false) { [weak self] ok in
      guard let self = self else { return }
      DispatchQueue.main.async {
        self.refreshHealthAuthorizationStatus()
        if !ok {
          self.errorMessage = "Health permissions are required to start."
        }
      }
    }
  }

  private func isoToTime(_ iso: String) -> TimeInterval? {
    guard !iso.isEmpty else { return nil }
    if let dt = ISO8601DateFormatter().date(from: iso) {
      let t = dt.timeIntervalSince1970
      return t.isFinite ? t : nil
    }
    return nil
  }

  private static func loadTreadmillCalibrationFactor(from key: String) -> Double {
    let raw = UserDefaults.standard.double(forKey: key)
    if raw.isFinite, raw >= 0.70, raw <= 1.30 { return raw }
    return 1.0
  }

  private var canControlWorkout: Bool {
    workoutSession != nil && workoutBuilder != nil && needsRecovery == false && recoveryIsVerified == true
  }

  // MARK: - Public actions

  func startRun() {
    startWorkoutWithGuard(label: "Starting Outdoor Run…", kind: .run, configuration: makeWorkoutConfig(.running, location: .outdoor), runEnvironment: .outdoor)
  }

  func startTreadmillRun() {
    startWorkoutWithGuard(label: "Starting Treadmill…", kind: .run, configuration: makeWorkoutConfig(.running, location: .indoor), runEnvironment: .treadmill)
  }

  func startLift() {
    startWorkoutWithGuard(label: "Starting Lift…", kind: .lift, configuration: makeWorkoutConfig(.traditionalStrengthTraining, location: .indoor), runEnvironment: nil)
  }

  func pause() {
    guard canControlWorkout else {
      DispatchQueue.main.async { self.errorMessage = "Needs attention on this watch." }
      return
    }
    guard let snap = snapshot, snap.state == .recording else { return }
    pauseStartDate = Date()
    lastDistanceMeters = nil
    lastDistanceSampleAt = nil
    recentSpeedSamplesMps = []
    smoothedSpeedMps = nil
    applyState(.paused, reason: "stateChange")
    workoutSession?.pause()
    stopLocationUpdates()
  }

  func resume() {
    guard canControlWorkout else {
      DispatchQueue.main.async { self.errorMessage = "Needs attention on this watch." }
      return
    }
    guard let snap = snapshot, snap.state == .paused else { return }
    if let pauseStartDate = pauseStartDate {
      pausedTotalSec += max(0, Int(Date().timeIntervalSince(pauseStartDate)))
    }
    self.pauseStartDate = nil
    lastDistanceMeters = nil
    lastDistanceSampleAt = nil
    applyState(.recording, reason: "stateChange")
    workoutSession?.resume()
    if snap.kind == .run, snap.runEnvironment == .outdoor { startLocationUpdatesIfAllowed() }
  }

  func armEnd() {
    guard canControlWorkout else {
      DispatchQueue.main.async { self.errorMessage = "Needs attention on this watch." }
      return
    }
    guard let snap = snapshot else { return }
    if snap.state == .recording || snap.state == .paused {
      applyState(.endingConfirm, reason: "stateChange")
      // Auto-revert if no confirm arrives.
      let currentSeq = seq
      DispatchQueue.main.asyncAfter(deadline: .now() + 2.6) { [weak self] in
        guard let self = self else { return }
        guard let snapNow = self.snapshot, snapNow.state == .endingConfirm else { return }
        // Only revert if no other state advanced.
        if self.seq == currentSeq {
          let revertTo: ZenithWatchSessionState = (self.pauseStartDate == nil) ? .recording : .paused
          self.applyState(revertTo, reason: "stateChange")
        }
      }
    }
  }

  func confirmEnd() {
    guard canControlWorkout else {
      DispatchQueue.main.async { self.errorMessage = "Needs attention on this watch." }
      return
    }
    guard let snap = snapshot, snap.state == .endingConfirm else { return }
    endWorkout()
  }

  func cancelEnd() {
    guard canControlWorkout else {
      DispatchQueue.main.async { self.errorMessage = "Needs attention on this watch." }
      return
    }
    guard let snap = snapshot, snap.state == .endingConfirm else { return }
    let revertTo: ZenithWatchSessionState = (pauseStartDate == nil) ? .recording : .paused
    applyState(revertTo, reason: "stateChange")
  }

  func discard() {
    // Discard is allowed only after ended; it keeps truth honest (not saved to Health).
    clearAll()
  }

  func addSet() {
    guard var snap = snapshot, snap.kind == .lift else { return }
    guard snap.state == .recording || snap.state == .paused else { return }
    let baseline = snap.setCount
    snap.setCount = max(0, baseline + 1)
    setUndoUntilEpochMs = Int64(Date().timeIntervalSince1970 * 1000) + 5000
    applyNewSnapshotInternal(snap, reason: "metricThreshold")
  }

  func undoSet() {
    guard let until = setUndoUntilEpochMs else { return }
    if Int64(Date().timeIntervalSince1970 * 1000) > until { setUndoUntilEpochMs = nil; return }
    guard var snap = snapshot, snap.kind == .lift else { return }
    snap.setCount = max(0, snap.setCount - 1)
    setUndoUntilEpochMs = nil
    applyNewSnapshotInternal(snap, reason: "metricThreshold")
  }

  // MARK: - Core workout lifecycle

  private func startFlowLog(_ event: String, fields: [String: String] = [:]) {
#if DEBUG
    var payload = fields
    if let id = startAttemptId { payload["attempt"] = id }
    if let k = startAttemptedKind { payload["kind"] = k.rawValue }
    let suffix = payload.isEmpty
      ? ""
      : " " + payload.map { "\($0.key)=\($0.value)" }.sorted().joined(separator: " ")
    print("ZENITH_WATCH_START_FLOW \(event)\(suffix)")
#endif
  }

  private func startFlowCleanup() {
    startTimeoutWorkItem?.cancel()
    startTimeoutWorkItem = nil
    startAttemptId = nil
    startAttemptedKind = nil
    // All `@Published` mutations must occur on main to avoid SwiftUI getting stuck in an
    // inconsistent render state (especially during sheet/overlay transitions).
    if Thread.isMainThread {
      startInProgress = false
      startInProgressLabel = ""
    } else {
      DispatchQueue.main.async {
        self.startInProgress = false
        self.startInProgressLabel = ""
      }
    }
    startFlowLog("cleanup")
  }

  private func startWorkoutWithGuard(label: String, kind: ZenithWorkoutKind, configuration: HKWorkoutConfiguration, runEnvironment: ZenithRunEnvironment?) {
    // Prevent double-taps / rapid retries from entering a half-started state.
    if startInProgress {
      startFlowLog("blocked_reentry", fields: ["label": label])
      return
    }
    startTimeoutWorkItem?.cancel()
    startTimeoutWorkItem = nil

    startAttemptId = "\(Int(Date().timeIntervalSince1970 * 1000))-\(Int.random(in: 1000...9999))"
    startAttemptedKind = kind
    startFlowLog("attempt", fields: ["label": label, "env": runEnvironment?.rawValue ?? "none"])

    DispatchQueue.main.async {
      self.startInProgress = true
      self.startInProgressLabel = label
    }

    // Hard timeout: if HealthKit auth/session creation never returns, we must not leave the user in limbo.
    let timeoutItem = DispatchWorkItem { [weak self] in
      guard let self = self else { return }
      // Only fire if we still haven't produced a live snapshot.
      if self.startInProgress && (self.snapshot == nil || self.snapshot?.state == .idle) {
        self.startFlowLog("timeout")
        self.startFlowCleanup()
        self.errorMessage = "Could not start the workout. Try again."
      }
    }
    startTimeoutWorkItem = timeoutItem
    DispatchQueue.main.asyncAfter(deadline: .now() + 7.0, execute: timeoutItem)

#if DEBUG
    DispatchQueue.main.asyncAfter(deadline: .now() + 7.2) { [weak self] in
      guard let self = self else { return }
      if self.startInProgress {
        self.startFlowLog("ASSERT_FORBIDDEN_startInProgress_gt_timeout")
      }
    }
#endif

    startWorkout(kind: kind, configuration: configuration, runEnvironment: runEnvironment)
  }

  private func startWorkout(kind: ZenithWorkoutKind, configuration: HKWorkoutConfiguration, runEnvironment: ZenithRunEnvironment?) {
    if let existing = snapshot, existing.state == .recording || existing.state == .paused || existing.state == .endingConfirm {
      DispatchQueue.main.async {
        self.startFlowLog("fail_duplicate_session", fields: ["state": existing.state.rawValue])
        self.startFlowCleanup()
        self.errorMessage = "Workout already active."
        self.needsRecovery = true
        self.recoveryIsVerified = self.workoutSession != nil && self.workoutBuilder != nil
      }
      return
    }

    requestAuthorizationIfNeeded(needsRoute: kind == .run && runEnvironment == .outdoor) { [weak self] ok in
      guard let self = self else { return }
      if !ok {
        DispatchQueue.main.async {
          self.startFlowLog("fail_not_authorized")
          self.startFlowCleanup()
          self.errorMessage = "Health permissions are required to start."
        }
        return
      }

      let sessionId = "watch_session_\(Int(Date().timeIntervalSince1970 * 1000))_\(Int.random(in: 1000...9999))"
      self.startDate = Date()
      self.pauseStartDate = nil
      self.pausedTotalSec = 0
      self.lastLocation = nil
      self.routeLocations = []
      self.workoutRouteBuilder = nil
      self.seq = 0
      self.hrSumBpm = 0
      self.hrSampleCount = 0
      self.hrMaxBpm = 0
      self.lastDistanceMeters = nil
      self.lastDistanceSampleAt = nil
      self.recentSpeedSamplesMps = []
      self.smoothedSpeedMps = nil
      self.treadmillFactorUsedThisSession = runEnvironment == .treadmill ? self.treadmillCalibrationFactor : 1.0

      do {
        let session = try HKWorkoutSession(healthStore: self.healthStore, configuration: configuration)
        let builder = session.associatedWorkoutBuilder()
        builder.dataSource = HKLiveWorkoutDataSource(healthStore: self.healthStore, workoutConfiguration: configuration)
        session.delegate = self
        builder.delegate = self
        self.workoutSession = session
        self.workoutBuilder = builder
        self.needsRecovery = false
        self.recoveryIsVerified = true
        if kind == .run, runEnvironment == .outdoor {
          self.workoutRouteBuilder = HKWorkoutRouteBuilder(healthStore: self.healthStore, device: HKDevice.local())
        }

        DispatchQueue.main.async {
          self.startFlowLog("success", fields: ["sessionId": sessionId, "env": runEnvironment?.rawValue ?? "none"])
          self.startFlowCleanup()
        }

        self.applyNewSnapshotInternal(
          ZenithWatchSessionSnapshot(
            kind: kind,
            sessionId: sessionId,
            state: .recording,
            runEnvironment: runEnvironment,
            startedAtUtc: ISO8601DateFormatter().string(from: self.startDate ?? Date()),
            endedAtUtc: nil,
            elapsedTimeSec: 0,
            movingTimeSec: 0,
            pausedTotalSec: 0,
            rawDistanceMiles: nil,
            treadmillCalibrationFactorUsed: runEnvironment == .treadmill ? self.treadmillFactorUsedThisSession : nil,
            totalDistanceMiles: 0,
            paceMinPerMile: nil,
            totalCalories: 0,
            setCount: 0,
            intensityBand: "low",
            seq: 1,
            lastUpdatedAtUtc: ISO8601DateFormatter().string(from: Date())
          ),
          reason: "stateChange"
        )

        session.startActivity(with: self.startDate ?? Date())
        builder.beginCollection(withStart: self.startDate ?? Date()) { _, _ in }

        self.startTimers()
        if kind == .run, runEnvironment == .outdoor { self.startLocationUpdatesIfAllowed() }
      } catch {
        DispatchQueue.main.async {
          self.startFlowLog("fail_exception")
          self.startFlowCleanup()
          self.errorMessage = "Could not start workout."
        }
      }
    }
  }

  private func endWorkout() {
    stopLocationUpdates()
    workoutBuilder?.endCollection(withEnd: Date()) { [weak self] _, _ in
      guard let self = self else { return }
      self.workoutSession?.end()
      self.workoutBuilder?.finishWorkout { workout, _ in
        DispatchQueue.main.async {
          self.applyState(.ended, reason: "stateChange")
        }
        self.finalizeRouteIfPossible(workout: workout)
        // Send a finalize packet to phone (best-effort).
        self.sendFinalizeToPhone(workout: workout)
      }
    }
  }

  // MARK: - Snapshot updates

  private func applyState(_ next: ZenithWatchSessionState, reason: String) {
    guard var snap = snapshot else { return }
    snap.state = next
    if next == .ended {
      snap.endedAtUtc = ISO8601DateFormatter().string(from: Date())
    }
    applyNewSnapshotInternal(snap, reason: reason)
  }

  private func applyNewSnapshotInternal(_ snap: ZenithWatchSessionSnapshot, reason: String) {
    DispatchQueue.main.async {
      self.seq += 1
      var next = snap
      next.seq = max(next.seq, self.seq)
      next.lastUpdatedAtUtc = ISO8601DateFormatter().string(from: Date())
      self.snapshot = next
      self.persistSnapshot(next)
      self.sendSnapshotToPhone(next, reason: reason)
    }
  }

  // MARK: - Timers

  private func startTimers() {
    tickTimer?.invalidate()
    snapshotPersistTimer?.invalidate()

    tickTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
      self?.tick()
    }
    snapshotPersistTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
      guard let self = self, let snap = self.snapshot else { return }
      self.persistSnapshot(snap)
    }
  }

  private func stopTimers() {
    tickTimer?.invalidate()
    snapshotPersistTimer?.invalidate()
    tickTimer = nil
    snapshotPersistTimer = nil
  }

  private func tick() {
    guard var snap = snapshot else { return }
    guard let startDate = startDate else { return }

    if let until = setUndoUntilEpochMs, Int64(Date().timeIntervalSince1970 * 1000) > until {
      DispatchQueue.main.async { self.setUndoUntilEpochMs = nil }
    }

    let elapsed = Int(Date().timeIntervalSince(startDate))
    let pausedNow = pausedTotalSec + (pauseStartDate != nil ? max(0, Int(Date().timeIntervalSince(pauseStartDate!))) : 0)
    let moving = max(0, elapsed - pausedNow)

    snap.elapsedTimeSec = elapsed
    snap.pausedTotalSec = pausedNow
    snap.movingTimeSec = moving

    if snap.kind == .run {
      // Truth-first distance: prefer HealthKit workout engine distance for both outdoor and treadmill runs.
      if let distQty = workoutBuilder?.statistics(for: HKQuantityType(.distanceWalkingRunning))?.sumQuantity() {
        let meters = distQty.doubleValue(for: HKUnit.meter())
        if meters.isFinite, meters >= 0 {
          let miles = meters / metersPerMile
          let rawMiles = max(0, miles.isFinite ? miles : 0)
          snap.rawDistanceMiles = rawMiles

          let factor = (snap.runEnvironment == .treadmill) ? treadmillFactorUsedThisSession : 1.0
          snap.treadmillCalibrationFactorUsed = (snap.runEnvironment == .treadmill) ? factor : nil
          snap.totalDistanceMiles = max(0, rawMiles * factor)

          updateSmoothedPaceIfPossible(nextDistanceMeters: meters, snap: &snap, treadmillFactor: factor)
        }
      }
    }

    // Pull calories from workout builder if available.
    if let energy = workoutBuilder?.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity() {
      let kcal = energy.doubleValue(for: HKUnit.kilocalorie())
      snap.totalCalories = max(0, Int(round(kcal)))
    }

    // HR truthfulness: compute derived HR only from live builder HR statistics (never from GPS).
    if snap.state == .recording,
       let hrQty = workoutBuilder?.statistics(for: HKQuantityType(.heartRate))?.mostRecentQuantity()
    {
      let unit = HKUnit.count().unitDivided(by: HKUnit.minute())
      let bpm = hrQty.doubleValue(for: unit)
      if bpm.isFinite, bpm >= 30, bpm <= 240 {
        hrSumBpm += bpm
        hrSampleCount += 1
        hrMaxBpm = max(hrMaxBpm, bpm)
      }
    }

    // Intensity band: conservative; can improve later with HR coverage.
    if snap.totalCalories >= 250 { snap.intensityBand = "high" }
    else if snap.totalCalories >= 120 { snap.intensityBand = "moderate" }
    else { snap.intensityBand = "low" }

    applyNewSnapshotInternal(snap, reason: "tick")
  }

  private func updateSmoothedPaceIfPossible(nextDistanceMeters: Double, snap: inout ZenithWatchSessionSnapshot, treadmillFactor: Double) {
    guard snap.state == .recording else {
      smoothedSpeedMps = nil
      recentSpeedSamplesMps = []
      lastDistanceMeters = nil
      lastDistanceSampleAt = nil
      snap.paceMinPerMile = nil
      return
    }

    let now = Date()
    guard let lastMeters = lastDistanceMeters, let lastAt = lastDistanceSampleAt else {
      lastDistanceMeters = nextDistanceMeters
      lastDistanceSampleAt = now
      return
    }

    let dt = now.timeIntervalSince(lastAt)
    if !dt.isFinite || dt < 0.5 || dt > 2.5 {
      lastDistanceMeters = nextDistanceMeters
      lastDistanceSampleAt = now
      return
    }

    let deltaMeters = nextDistanceMeters - lastMeters
    lastDistanceMeters = nextDistanceMeters
    lastDistanceSampleAt = now

    if !deltaMeters.isFinite || deltaMeters < 0 { return }
    let factor = (treadmillFactor.isFinite && treadmillFactor > 0) ? treadmillFactor : 1.0
    let speedMps = (deltaMeters / dt) * factor
    if !speedMps.isFinite || speedMps < 0 { return }

    // Outlier protection: never let a single bad sample cause an insane pace jump.
    if speedMps > 10.0 { return }

    // Movement gating: if essentially not moving, blank pace instead of flickering.
    if speedMps < 0.55 {
      smoothedSpeedMps = nil
      recentSpeedSamplesMps = []
      snap.paceMinPerMile = nil
      return
    }

    recentSpeedSamplesMps.append(speedMps)
    if recentSpeedSamplesMps.count > 30 { recentSpeedSamplesMps.removeFirst(recentSpeedSamplesMps.count - 30) }

    let recent = recentSpeedSamplesMps.suffix(10)
    let mean = recent.reduce(0, +) / Double(max(1, recent.count))
    let variance = recent.reduce(0.0) { partial, v in
      let d = v - mean
      return partial + (d * d)
    } / Double(max(1, recent.count))
    let std = sqrt(max(0, variance))
    let cv = mean > 0 ? (std / mean) : 1.0

    let window: Int
    if cv < 0.08 { window = 3 }
    else if cv > 0.22 { window = 8 }
    else { window = 5 }

    let alpha: Double = (window == 3) ? 0.35 : (window == 8 ? 0.18 : 0.25)

    let windowSamples = Array(recentSpeedSamplesMps.suffix(window)).sorted()
    let median: Double
    if windowSamples.isEmpty {
      return
    } else if windowSamples.count % 2 == 0 {
      median = (windowSamples[windowSamples.count / 2 - 1] + windowSamples[windowSamples.count / 2]) / 2.0
    } else {
      median = windowSamples[windowSamples.count / 2]
    }

    let nextSmoothed = (smoothedSpeedMps == nil) ? median : ((smoothedSpeedMps ?? median) * (1 - alpha) + median * alpha)
    if !nextSmoothed.isFinite || nextSmoothed <= 0 { return }
    smoothedSpeedMps = nextSmoothed

    var pace = (metersPerMile / nextSmoothed) / 60.0
    if !pace.isFinite || pace <= 0 { snap.paceMinPerMile = nil; return }

    // Clamp pace change to avoid visible flicker (max ~30 sec/mi per second).
    if let prev = snap.paceMinPerMile, prev.isFinite, prev > 0 {
      let maxDelta = 0.5 * dt
      pace = min(prev + maxDelta, max(prev - maxDelta, pace))
    }

    snap.paceMinPerMile = pace
  }

  // MARK: - Location

  private func startLocationUpdatesIfAllowed() {
    let mgr = CLLocationManager()
    locationManager = mgr
    mgr.delegate = self
    mgr.desiredAccuracy = kCLLocationAccuracyBest
    mgr.activityType = .fitness
    mgr.requestWhenInUseAuthorization()
    mgr.startUpdatingLocation()
  }

  private func finalizeRouteIfPossible(workout: HKWorkout?) {
    guard let workout = workout else { return }
    guard let builder = workoutRouteBuilder else { return }
    let points = routeLocations
    if points.isEmpty { return }

    // Best-effort: write route to HealthKit. Failures should not block finalize messaging.
    builder.insertRouteData(points) { [weak self] _, _ in
      guard let self = self else { return }
      builder.finishRoute(with: workout, metadata: nil) { _, error in
        if let error = error {
          DispatchQueue.main.async { self.errorMessage = "Route save failed: \(error.localizedDescription)" }
        }
      }
    }
  }

  private func stopLocationUpdates() {
    locationManager?.stopUpdatingLocation()
    locationManager?.delegate = nil
    locationManager = nil
    lastLocation = nil
  }

  // MARK: - Persistence / Recovery

  private func persistSnapshot(_ snap: ZenithWatchSessionSnapshot) {
    if let data = try? JSONEncoder().encode(snap) {
      UserDefaults.standard.set(data, forKey: snapshotKey)
    }
  }

  private func loadRecoverySnapshot() {
    guard let data = UserDefaults.standard.data(forKey: snapshotKey),
          let snap = try? JSONDecoder().decode(ZenithWatchSessionSnapshot.self, from: data)
    else { return }
    // Only recover if it looks active.
    if snap.state == .recording || snap.state == .paused || snap.state == .endingConfirm {
      self.needsRecovery = true
      // Snapshot-only recovery is not a proof of an active system workout session.
      self.recoveryIsVerified = false
      self.startDate = ISO8601DateFormatter().date(from: snap.startedAtUtc)
      self.pausedTotalSec = snap.pausedTotalSec
      self.seq = snap.seq
      // Push an immediate truth-first state update to the phone so UI can show "Needs attention"
      // rather than stale "Recording/Paused" until the user resolves.
      //
      // Important: phone-side mirrors only apply strictly increasing seq values, so we must emit
      // a new seq here instead of replaying the same snapshot.
      applyNewSnapshotInternal(snap, reason: "sync")
      attemptReattachToActiveWorkoutSession(expectedSnapshot: snap)
    }
  }

  private func attemptReattachToActiveWorkoutSession(expectedSnapshot snap: ZenithWatchSessionSnapshot) {
    // Recovery is best-effort and must never create a phantom session. If we cannot prove a live
    // HKWorkoutSession exists, we keep `needsRecovery=true` and leave controls disabled.
    requestAuthorizationIfNeeded(needsRoute: snap.kind == .run && snap.runEnvironment == .outdoor) { [weak self] ok in
      guard let self = self else { return }
      guard ok else {
        DispatchQueue.main.async { self.errorMessage = "Needs attention on this watch." }
        return
      }

      self.healthStore.recoverActiveWorkoutSession { [weak self] session, error in
        guard let self = self else { return }
        DispatchQueue.main.async {
          if let error = error {
            self.errorMessage = "Needs attention on this watch. (\(error.localizedDescription))"
          }

          guard let session = session else {
            // No active session to attach to. Keep truth-first state.
            return
          }

          let builder = session.associatedWorkoutBuilder()
          session.delegate = self
          builder.delegate = self

          // Reassert a data source if the system handed us a builder without one.
          if builder.dataSource == nil {
            let config = session.workoutConfiguration
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: self.healthStore, workoutConfiguration: config)
          }

          self.workoutSession = session
          self.workoutBuilder = builder

          // If the recovered system session is already ended, do not claim success.
          if session.state == .ended || session.state == .notStarted {
            self.errorMessage = "Needs attention on this watch."
            self.workoutSession = nil
            self.workoutBuilder = nil
            return
          }

          // Verified: a live system workout session exists.
          self.needsRecovery = false
          self.recoveryIsVerified = true
          self.errorMessage = nil

          // Restart timers and location collection based on the recovered snapshot intent.
          self.stopTimers()
          self.startTimers()

          if snap.kind == .run, snap.runEnvironment == .outdoor {
            if self.workoutRouteBuilder == nil {
              self.workoutRouteBuilder = HKWorkoutRouteBuilder(healthStore: self.healthStore, device: HKDevice.local())
            }
            self.startLocationUpdatesIfAllowed()
          }

          // Align snapshot state to the actual system session state for truthfulness.
          var next = snap
          if session.state == .paused {
            next.state = .paused
          } else {
            next.state = .recording
          }
          self.applyNewSnapshotInternal(next, reason: "recoveryVerified")
        }
      }
    }
  }

  private func clearAll() {
    stopTimers()
    stopLocationUpdates()
    startFlowCleanup()
    workoutSession = nil
    workoutBuilder = nil
    workoutRouteBuilder = nil
    startDate = nil
    pauseStartDate = nil
    pausedTotalSec = 0
    seq = 0
    hrSumBpm = 0
    hrSampleCount = 0
    hrMaxBpm = 0
    lastDistanceMeters = nil
    lastDistanceSampleAt = nil
    recentSpeedSamplesMps = []
    smoothedSpeedMps = nil
    treadmillFactorUsedThisSession = 1.0
    snapshot = nil
    needsRecovery = false
    recoveryIsVerified = true
    UserDefaults.standard.removeObject(forKey: snapshotKey)
  }

  // MARK: - HealthKit auth

  private func requestAuthorizationIfNeeded(needsRoute: Bool, completion: @escaping (Bool) -> Void) {
    // Do not early-return based on `isHealthDataAvailable()` on watchOS.
    // If HealthKit is truly unavailable, `requestAuthorization` will fail and we surface that via `ok=false`.
    var shareTypes: Set<HKSampleType> = [HKObjectType.workoutType()]
    if needsRoute {
      shareTypes.insert(HKSeriesType.workoutRoute())
    }
    let readTypes: Set<HKObjectType> = Set([
      HKObjectType.quantityType(forIdentifier: .heartRate),
      HKObjectType.quantityType(forIdentifier: .activeEnergyBurned),
      HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning)
    ].compactMap { $0 })

    healthStore.requestAuthorization(toShare: shareTypes, read: readTypes) { ok, _ in
      // Always bounce to main: downstream start flows touch `@Published` state and SwiftUI presentation.
      DispatchQueue.main.async {
        self.refreshHealthAuthorizationStatus()
        completion(ok)
      }
    }
  }

  private func makeWorkoutConfig(_ activityType: HKWorkoutActivityType, location: HKWorkoutSessionLocationType) -> HKWorkoutConfiguration {
    let config = HKWorkoutConfiguration()
    config.activityType = activityType
    config.locationType = location
    return config
  }

  // MARK: - WatchConnectivity

  private func startWatchConnectivity() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    session.activate()
  }

  private func sendPermissionsPingToPhone() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated else { return }
    session.transferUserInfo(["type": "WATCH_PERMISSION_CHECK", "payload": ["ts": ISO8601DateFormatter().string(from: Date())]])
    if session.isReachable {
      session.sendMessage(["type": "WATCH_PERMISSION_CHECK", "payload": ["ts": ISO8601DateFormatter().string(from: Date())]], replyHandler: nil, errorHandler: nil)
    }
  }

  private func sendSnapshotToPhone(_ snap: ZenithWatchSessionSnapshot, reason: String) {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated else { return }

    // WatchConnectivity requires property-list safe payloads. Never include Swift Optionals (`as Any`)
    // because they will crash at runtime when WCSession tries to serialize them.
    var payload: [String: Any] = [
      "kind": snap.kind.rawValue,
      "sessionId": snap.sessionId,
      "state": snap.state.rawValue,
      "needsRecovery": needsRecovery,
      "recoveryVerified": recoveryIsVerified,
      "startedAtWatch": snap.startedAtUtc,
      "elapsedTimeSec": snap.elapsedTimeSec,
      "movingTimeSec": snap.movingTimeSec,
      "pausedTotalSec": snap.pausedTotalSec,
      "lastUpdatedAtWatch": snap.lastUpdatedAtUtc,
      "seq": snap.seq,
      "sourceDevice": "watch",
      "reasonCode": reason
    ]

    if let ended = snap.endedAtUtc { payload["endedAtWatch"] = ended }

    if snap.kind == .run {
      if let env = snap.runEnvironment?.rawValue { payload["runEnvironment"] = env }
      if let rawMiles = snap.rawDistanceMiles { payload["rawDistanceMiles"] = rawMiles }
      if let factor = snap.treadmillCalibrationFactorUsed { payload["treadmillCalibrationFactorUsed"] = factor }
      payload["totalDistanceMiles"] = snap.totalDistanceMiles
      if let pace = snap.paceMinPerMile { payload["paceMinPerMile"] = pace }
    } else {
      payload["totalCalories"] = snap.totalCalories
      payload["setCount"] = snap.setCount
      payload["intensityBand"] = snap.intensityBand
    }

    sendMessageToPhone(type: "STATE_UPDATE", payload: payload)
  }

  private func sendFinalizeToPhone(workout: HKWorkout?) {
    guard let snap = snapshot else { return }
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated else { return }

    let endedAtUtc = snap.endedAtUtc ?? ISO8601DateFormatter().string(from: Date())
    let finalizeId = "finalize_\(snap.sessionId)_\(Int64(Date().timeIntervalSince1970 * 1000))"

    var payload: [String: Any] = [
      "kind": snap.kind.rawValue,
      "sessionId": snap.sessionId,
      "finalizeId": finalizeId,
      "startedAtUtc": snap.startedAtUtc,
      "endedAtUtc": endedAtUtc,
      "elapsedTimeSec": snap.elapsedTimeSec,
      "movingTimeSec": snap.movingTimeSec,
      "pausedTotalSec": snap.pausedTotalSec,
      "seq": snap.seq
    ]

    if snap.kind == .run {
      payload["totalDistanceMiles"] = snap.totalDistanceMiles
      if let env = snap.runEnvironment?.rawValue { payload["runEnvironment"] = env }
      if let raw = snap.rawDistanceMiles { payload["rawDistanceMiles"] = raw }
      if let factor = snap.treadmillCalibrationFactorUsed { payload["treadmillCalibrationFactorUsed"] = factor }
      let route = encodeRoutePreview(maxPoints: 180)
      if !route.isEmpty { payload["route"] = route }
    } else {
      payload["totalCalories"] = snap.totalCalories
      payload["setCount"] = snap.setCount
      payload["intensityBand"] = snap.intensityBand
    }

    // HR truth: only declare HR available when we have enough samples to be meaningful.
    let movingTimeSec = max(0, snap.movingTimeSec)
    let coverageRatio = movingTimeSec > 0 ? (Double(hrSampleCount) / Double(movingTimeSec)) : 0
    let hrAvailable = hrSampleCount >= 3 && coverageRatio >= 0.15
    payload["hrAvailable"] = hrAvailable
    if hrAvailable {
      let avg = hrSumBpm / Double(max(1, hrSampleCount))
      let coverage = min(1, max(0, coverageRatio))
      payload["avgHrBpm"] = Int(round(avg))
      payload["maxHrBpm"] = Int(round(hrMaxBpm))
      payload["hrCoverageRatio"] = coverage
      payload["hrConfidence"] = Int(round(coverage * 100))
    }

    sendMessageToPhone(type: "FINALIZE", payload: payload)
  }

  private func encodeRoutePreview(maxPoints: Int) -> [[String: Any]] {
    let points = routeLocations
    if points.isEmpty || maxPoints <= 0 { return [] }
    let step = max(1, Int(ceil(Double(points.count) / Double(maxPoints))))
    var out: [[String: Any]] = []
    out.reserveCapacity(min(maxPoints, points.count))
    for i in stride(from: 0, to: points.count, by: step) {
      let p = points[i]
      let lat = p.coordinate.latitude
      let lon = p.coordinate.longitude
      if !lat.isFinite || !lon.isFinite { continue }
      let ts = Int64(p.timestamp.timeIntervalSince1970 * 1000)
      if ts <= 0 { continue }
      var item: [String: Any] = [
        "latitude": lat,
        "longitude": lon,
        "timestamp": ts
      ]
      if p.verticalAccuracy >= 0 { item["altitude"] = p.altitude }
      if p.horizontalAccuracy >= 0 { item["accuracy"] = p.horizontalAccuracy }
      if p.speed >= 0 { item["speed"] = p.speed }
      out.append(item)
    }
    return out
  }
}

extension WatchWorkoutManager: HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
  func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {}
  func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
    DispatchQueue.main.async { self.errorMessage = "Workout error: \(error.localizedDescription)" }
  }

  func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
  func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {}
}

extension WatchWorkoutManager: CLLocationManagerDelegate {
  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard var snap = snapshot else { return }
    guard snap.kind == .run else { return }
    guard snap.runEnvironment == .outdoor else { return }
    guard snap.state == .recording else { return }

    for loc in locations {
      // Basic gating: discard wildly inaccurate points.
      if loc.horizontalAccuracy < 0 || loc.horizontalAccuracy > 50 { continue }
      lastLocation = loc
      routeLocations.append(loc)
    }
    applyNewSnapshotInternal(snap, reason: "metricThreshold")
  }
}

extension WatchWorkoutManager: WCSessionDelegate {
  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String : Any] = [:]) {
    handleInboundMessage(userInfo)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String : Any]) {
    handleInboundMessage(message)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String : Any], replyHandler: @escaping ([String : Any]) -> Void) {
    let response = handleInboundMessage(message)
    replyHandler(response ?? [:])
  }

  @discardableResult
  private func handleInboundMessage(_ message: [String: Any]) -> [String: Any]? {
    guard let type = message["type"] as? String else { return nil }

    if type == "TREADMILL_CALIBRATION_UPDATE" {
      guard let payload = message["payload"] as? [String: Any] else { return ["accepted": false, "reasonCode": "missing_payload"] }
      let rawFactor = Double(String(describing: payload["factor"] ?? "")) ?? Double((payload["factor"] as? NSNumber)?.doubleValue ?? 1)
      let updatedAtUtc = String(describing: payload["updatedAtUtc"] ?? "")
      let nonce = String(describing: payload["nonce"] ?? "")

      let currentUpdatedAt = isoToTime(treadmillCalibrationUpdatedAtUtc) ?? 0
      let incomingUpdatedAt = isoToTime(updatedAtUtc) ?? 0

      let status: String
      if !rawFactor.isFinite || rawFactor < 0.70 || rawFactor > 1.30 || nonce.isEmpty {
        status = "invalid"
      } else if incomingUpdatedAt > 0 && incomingUpdatedAt < currentUpdatedAt {
        status = "ignored_stale"
      } else if incomingUpdatedAt == 0 && currentUpdatedAt > 0 {
        // No timestamp provided; treat as stale to avoid silent rollbacks.
        status = "ignored_stale"
      } else {
        status = "applied"
        treadmillCalibrationFactor = rawFactor
        treadmillCalibrationUpdatedAtUtc = updatedAtUtc.isEmpty ? ISO8601DateFormatter().string(from: Date()) : updatedAtUtc
        UserDefaults.standard.set(rawFactor, forKey: treadmillCalibrationKey)
        UserDefaults.standard.set(treadmillCalibrationUpdatedAtUtc, forKey: treadmillCalibrationUpdatedAtKey)
      }

      let ackPayload: [String: Any] = [
        "factorApplied": treadmillCalibrationFactor,
        "appliedAtUtc": ISO8601DateFormatter().string(from: Date()),
        "nonce": nonce,
        "status": status,
      ]

      // Always ACK (even if stale/invalid) so the phone can stop retrying or mark blocked.
      sendCalibrationAckToPhone(ackPayload)
      return ["type": "TREADMILL_CALIBRATION_ACK", "payload": ackPayload]
    }

    if type != "COMMAND_REQUEST" { return ["accepted": false, "reasonCode": "unsupported_type"] }
    guard let payload = message["payload"] as? [String: Any] else { return ["accepted": false, "reasonCode": "missing_payload"] }
    let kind = String(describing: payload["kind"] ?? "run")
    let commandType = String(describing: payload["commandType"] ?? "")

    // Only accept commands for the active session.
    if let snap = snapshot {
      if String(describing: payload["sessionId"] ?? "") != snap.sessionId {
        return ["accepted": false, "reasonCode": "session_mismatch"]
      }
    }

    if kind == "run" || kind == "lift" {
      if commandType == "pause" || commandType == "resume" || commandType == "requestEnd" || commandType == "confirmEnd" {
        if !canControlWorkout {
          return ["accepted": false, "reasonCode": "recovery_unverified", "snapshot": snapshotAsPayload()]
        }
      }
      if commandType == "pause" { pause(); return ["accepted": true, "snapshot": snapshotAsPayload()] }
      if commandType == "resume" { resume(); return ["accepted": true, "snapshot": snapshotAsPayload()] }
      if commandType == "requestEnd" { armEnd(); return ["accepted": true, "snapshot": snapshotAsPayload()] }
      if commandType == "confirmEnd" { confirmEnd(); return ["accepted": true, "snapshot": snapshotAsPayload()] }
    }
    return ["accepted": false, "reasonCode": "unsupported_command"]
  }

  private func sendCalibrationAckToPhone(_ payload: [String: Any]) {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated else { return }
    sendMessageToPhone(type: "TREADMILL_CALIBRATION_ACK", payload: payload)
  }

  private func snapshotAsPayload() -> [String: Any] {
    guard let snap = snapshot else { return [:] }
    if snap.kind == .run {
      var payload: [String: Any] = [
        "kind": snap.kind.rawValue,
        "sessionId": snap.sessionId,
        "state": snap.state.rawValue,
        "needsRecovery": needsRecovery,
        "recoveryVerified": recoveryIsVerified,
        "startedAtWatch": snap.startedAtUtc,
        "elapsedTimeSec": snap.elapsedTimeSec,
        "movingTimeSec": snap.movingTimeSec,
        "pausedTotalSec": snap.pausedTotalSec,
        "totalDistanceMiles": snap.totalDistanceMiles,
        "lastUpdatedAtWatch": snap.lastUpdatedAtUtc,
        "seq": snap.seq,
        "sourceDevice": "watch",
        "reasonCode": "ackResponse"
      ]
      if let env = snap.runEnvironment?.rawValue { payload["runEnvironment"] = env }
      if let ended = snap.endedAtUtc { payload["endedAtWatch"] = ended }
      if let raw = snap.rawDistanceMiles { payload["rawDistanceMiles"] = raw }
      if let factor = snap.treadmillCalibrationFactorUsed { payload["treadmillCalibrationFactorUsed"] = factor }
      if let pace = snap.paceMinPerMile { payload["paceMinPerMile"] = pace }
      return payload
    }
    var payload: [String: Any] = [
      "kind": snap.kind.rawValue,
      "sessionId": snap.sessionId,
      "state": snap.state.rawValue,
      "needsRecovery": needsRecovery,
      "recoveryVerified": recoveryIsVerified,
      "startedAtWatch": snap.startedAtUtc,
      "elapsedTimeSec": snap.elapsedTimeSec,
      "movingTimeSec": snap.movingTimeSec,
      "pausedTotalSec": snap.pausedTotalSec,
      "totalCalories": snap.totalCalories,
      "setCount": snap.setCount,
      "intensityBand": snap.intensityBand,
      "lastUpdatedAtWatch": snap.lastUpdatedAtUtc,
      "seq": snap.seq,
      "sourceDevice": "watch",
      "reasonCode": "ackResponse"
    ]
    if let ended = snap.endedAtUtc { payload["endedAtWatch"] = ended }
    return payload
  }

  private func sendMessageToPhone(type: String, payload: [String: Any]) {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated else { return }

    let message: [String: Any] = ["type": type, "payload": payload]
    guard PropertyListSerialization.propertyList(message, isValidFor: .binary) else {
#if DEBUG
      print("ZENITH_WC_INVALID_PLIST type=\(type) payload=\(payload)")
#endif
      return
    }

    // Always queue a background-safe delivery.
    session.transferUserInfo(message)
    // If reachable (phone app active), also send immediate message for low latency.
    if session.isReachable {
      session.sendMessage(message, replyHandler: nil, errorHandler: nil)
    }
  }
}
