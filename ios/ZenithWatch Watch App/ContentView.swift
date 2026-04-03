import SwiftUI
import Combine
import WatchKit

struct ContentView: View {
  @StateObject private var manager = WatchWorkoutManager()
  @State private var pendingStart: PendingStart? = nil
  @State private var pauseArmedUntilMs: Int64? = nil

  private func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
  private func playHaptic(_ type: WKHapticType) { WKInterfaceDevice.current().play(type) }

  var body: some View {
    ZStack {
      if let snap = manager.snapshot, snap.state != .idle {
        activeSessionView(snap)
      } else {
        homeView
      }
    }
    .alert(isPresented: Binding(get: { manager.errorMessage != nil }, set: { _ in manager.errorMessage = nil })) {
      Alert(title: Text("Zenith"), message: Text(manager.errorMessage ?? ""), dismissButton: .default(Text("OK")))
    }
    .sheet(isPresented: $manager.needsRecovery) {
      recoverySheet
        // Truth-first: recovery requires an explicit resolution to avoid returning to a misleading UI.
        .interactiveDismissDisabled(true)
    }
    // Use `sheet(item:)` so we never present an "empty" sheet (blank blurred background) if state updates
    // happen out of order. The countdown sheet should exist *only* when we have a pending start action.
    .sheet(item: $pendingStart) { pending in
      CountdownSheet(
        label: pending.title,
        accent: pending.accent,
        onCancel: {
          pendingStart = nil
        },
        onComplete: {
          // Dismiss the sheet first, then kick off the workout start.
          pendingStart = nil
          playHaptic(.start)
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.10) {
            pending.start(manager)
          }
        }
      )
    }
  }

  private var homeView: some View {
    GeometryReader { proxy in
      let padH: CGFloat = 10
      let padV: CGFloat = 8
      let usableH = max(0, proxy.size.height - padV * 2)
      let headerH: CGFloat = 22
      // Explicit grid: header + primary + secondary.
      // Target: primary ~55-60% of remaining, secondary ~28-32%.
      let primaryH = max(usableH * 0.58, usableH * 0.52)
      let secondaryH = max(usableH * 0.30, usableH * 0.28)

      let blocked = !manager.isHealthAuthorized

      ZStack {
        Color.black.ignoresSafeArea()
        RadialGradient(
          colors: [
            Color(red: 0.0, green: 0.85, blue: 1.0).opacity(0.18),
            Color(red: 0.2, green: 0.35, blue: 1.0).opacity(0.06),
            Color.black.opacity(0.0)
          ],
          center: .topLeading,
          startRadius: 0,
          endRadius: 240
        )
        .ignoresSafeArea()

        VStack(alignment: .leading, spacing: 10) {
          Text("Zenith")
            .font(.system(.headline, design: .rounded).weight(.semibold))
            .foregroundStyle(Color.white.opacity(0.78))
            .frame(height: headerH, alignment: .topLeading)

          launcherPrimaryCard(height: primaryH, blocked: blocked)

          launcherSecondaryRow(height: secondaryH, blocked: blocked)
        }
        .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
        .padding(.horizontal, padH)
        .padding(.vertical, padV)
        .onAppear {
          manager.refreshHealthAuthorizationStatus()
        }

        if manager.startInProgress {
          startOverlay
        }
      }
    }
  }

  private var startOverlay: some View {
    ZStack {
      Color.black.opacity(0.55).ignoresSafeArea()
      VStack(spacing: 10) {
        ProgressView()
          .tint(.white)
        Text(manager.startInProgressLabel.isEmpty ? "Starting…" : manager.startInProgressLabel)
          .font(.system(.caption, design: .rounded).weight(.semibold))
          .multilineTextAlignment(.center)
          .foregroundStyle(Color.white.opacity(0.92))
          .padding(.horizontal, 10)
      }
    }
  }

  private func launcherPrimaryCard(height: CGFloat, blocked: Bool) -> some View {
    let radius: CGFloat = 22
    return Button(action: {
      if blocked {
        manager.checkPermissionsAgain()
      } else {
        startCountdown(.runOutdoor)
      }
    }) {
      ZStack {
        LinearGradient(
          colors: [Color(red: 0.0, green: 0.85, blue: 1.0), Color(red: 0.2, green: 0.35, blue: 1.0)],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )

        LinearGradient(
          colors: [Color.white.opacity(0.14), Color.black.opacity(0.0)],
          startPoint: .top,
          endPoint: .bottom
        )
        .blendMode(.screen)

        VStack(alignment: .leading, spacing: 6) {
          if blocked {
            Image(systemName: "shield.lefthalf.filled")
              .font(.system(size: 28, weight: .semibold))
              .foregroundStyle(Color.white.opacity(0.95))
            Text("PERMISSIONS\nREQUIRED")
              .font(.system(size: 20, weight: .heavy, design: .rounded))
              .foregroundStyle(Color.white)
              .lineLimit(2)
              .minimumScaleFactor(0.85)
            Text("Enable on iPhone")
              .font(.system(size: 12, weight: .semibold, design: .rounded))
              .foregroundStyle(Color.white.opacity(0.85))
            Text("CHECK AGAIN")
              .font(.system(size: 12, weight: .heavy, design: .rounded))
              .foregroundStyle(Color.white.opacity(0.95))
              .padding(.top, 2)
          } else {
            Image(systemName: "figure.run")
              .font(.system(size: 28, weight: .semibold))
              .foregroundStyle(Color.white.opacity(0.95))
            Text("START RUN")
              .font(.system(size: 22, weight: .heavy, design: .rounded))
              .foregroundStyle(Color.white)
              .lineLimit(1)
              .minimumScaleFactor(0.85)
            Text("Outdoor")
              .font(.system(size: 12, weight: .semibold, design: .rounded))
              .foregroundStyle(Color.white.opacity(0.85))
          }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .padding(.leading, 14)
        .padding(.trailing, 14)
      }
      .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
      .frame(height: height)
    }
    .buttonStyle(ZenithCardButtonStyle(cornerRadius: radius, scalePressed: 0.98, overlayOpacity: 0.10))
    .disabled(false)
  }

  private func launcherSecondaryRow(height: CGFloat, blocked: Bool) -> some View {
    return HStack(spacing: 12) {
      treadmillCard(height: height, blocked: blocked)
      liftCard(height: height, blocked: blocked)
    }
    .frame(height: height)
  }

  private func treadmillCard(height: CGFloat, blocked: Bool) -> some View {
    let radius: CGFloat = 22
    return Button(action: { if !blocked { startCountdown(.runTreadmill) } }) {
      ZStack {
        LinearGradient(
          colors: [Color(red: 0.05, green: 0.3, blue: 0.3), Color(red: 0.0, green: 0.45, blue: 0.55)],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )
        VStack(spacing: 6) {
          Image(systemName: "figure.run")
            .font(.system(size: 20, weight: .semibold))
            .foregroundStyle(Color.white.opacity(0.92))
          Text("TREADMILL")
            .font(.system(size: 12, weight: .semibold, design: .rounded))
            .foregroundStyle(Color.white.opacity(0.95))
            .lineLimit(1)
            .minimumScaleFactor(0.85)
        }
      }
      .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
    .buttonStyle(ZenithCardButtonStyle(cornerRadius: radius, scalePressed: 0.985, overlayOpacity: 0.12))
    .disabled(blocked)
    .opacity(blocked ? 0.35 : 1.0)
  }

  private func liftCard(height: CGFloat, blocked: Bool) -> some View {
    let radius: CGFloat = 22
    return Button(action: { if !blocked { startCountdown(.lift) } }) {
      ZStack {
        LinearGradient(
          colors: [Color(red: 0.18, green: 0.14, blue: 0.32), Color(red: 0.05, green: 0.35, blue: 0.6)],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )
        VStack(spacing: 6) {
          Image(systemName: "dumbbell.fill")
            .font(.system(size: 20, weight: .semibold))
            .foregroundStyle(Color.white.opacity(0.92))
          Text("LIFT")
            .font(.system(size: 12, weight: .semibold, design: .rounded))
            .foregroundStyle(Color.white.opacity(0.95))
            .lineLimit(1)
            .minimumScaleFactor(0.85)
        }
      }
      .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
    .buttonStyle(ZenithCardButtonStyle(cornerRadius: radius, scalePressed: 0.985, overlayOpacity: 0.12))
    .disabled(blocked)
    .opacity(blocked ? 0.35 : 1.0)
  }

  private func activeSessionView(_ snap: ZenithWatchSessionSnapshot) -> some View {
    VStack(spacing: 8) {
      Text(workoutTitle(snap))
        .font(.caption)
        .foregroundStyle(.secondary)
      Text(statusText(snap.state))
        .font(.caption2)
        .foregroundStyle(.secondary)

      Text(fmtDuration(snap.elapsedTimeSec))
        .font(.title2)
        .monospacedDigit()

      if snap.kind == .run {
        Text(String(format: "%.2f mi", max(0, snap.totalDistanceMiles)))
          .font(.headline)
          .monospacedDigit()
        Text("Pace \(fmtPace(snap.paceMinPerMile))")
          .font(.caption2)
          .foregroundStyle(.secondary)
      } else {
        Text("\(max(0, snap.setCount)) sets")
          .font(.headline)
          .monospacedDigit()
        Text("\(max(0, snap.totalCalories)) kcal")
          .font(.caption2)
          .foregroundStyle(.secondary)

        if snap.state == .recording || snap.state == .paused {
          HStack(spacing: 8) {
            Button("+ Set") { manager.addSet() }
              .buttonStyle(.borderedProminent)
            if let until = manager.setUndoUntilEpochMs, nowMs() <= until {
              Button("Undo") { manager.undoSet() }
                .buttonStyle(.bordered)
            }
          }
        }
      }

      if snap.state == .endingConfirm {
        Text("Double tap End to confirm")
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
      if let until = pauseArmedUntilMs, nowMs() <= until, snap.state == .recording {
        Text("Double tap Pause to confirm")
          .font(.caption2)
          .foregroundStyle(.secondary)
      }

      HStack(spacing: 10) {
        if snap.state == .recording {
          circleButton(title: "Pause", style: .pause) { onPauseTapped() }
        } else if snap.state == .paused {
          circleButton(title: "Resume", style: .go) {
            playHaptic(.start)
            manager.resume()
          }
        } else if snap.state == .endingConfirm {
          circleButton(title: "Cancel", style: .neutral) {
            pauseArmedUntilMs = nil
            playHaptic(.click)
            manager.cancelEnd()
          }
        } else {
          circleButton(title: "Resume", style: .go) {
            playHaptic(.start)
            manager.resume()
          }
        }

        if snap.state == .endingConfirm {
          circleButton(title: "End", style: .endStrong) {
            pauseArmedUntilMs = nil
            playHaptic(.success)
            manager.confirmEnd()
          }
        } else {
          circleButton(title: "End", style: .end) {
            pauseArmedUntilMs = nil
            playHaptic(.click)
            manager.armEnd()
          }
        }
      }
    }
    .padding()
  }

  private var recoverySheet: some View {
    VStack(spacing: 12) {
      Text(manager.recoveryIsVerified ? "Resolve session" : "Needs attention")
        .font(.headline)
      Text(
        manager.recoveryIsVerified
          ? "A session is still active on this watch."
          : "Zenith can’t confirm whether your system workout is still running. Controls are disabled to prevent inaccurate data."
      )
      .font(.caption)
      .foregroundStyle(.secondary)

      if let snap = manager.snapshot {
        Text("\(snap.kind.rawValue.capitalized) • \(statusText(snap.state))")
          .font(.caption2)
          .foregroundStyle(.secondary)
      }

      if manager.recoveryIsVerified {
        Button("Resume") {
          manager.needsRecovery = false
          // No auto-start beyond resuming state; user returns to main controls.
        }
        .buttonStyle(.borderedProminent)

        Button("End and save partial") {
          manager.needsRecovery = false
          manager.armEnd()
        }
        .buttonStyle(.bordered)
      }

      Button(manager.recoveryIsVerified ? "Discard" : "Discard session") {
        manager.needsRecovery = false
        manager.discard()
      }
      .buttonStyle(.bordered)
      .tint(.red)

      if !manager.recoveryIsVerified {
        Button("Discard and start new") {
          manager.needsRecovery = false
          manager.discard()
          // User returns to home to start intentionally.
        }
        .buttonStyle(.bordered)
      }
    }
    .padding()
  }

  private func statusText(_ state: ZenithWatchSessionState) -> String {
    switch state {
    case .idle: return "Ready"
    case .recording: return "Recording"
    case .paused: return "Paused"
    case .endingConfirm: return "Confirm end"
    case .ended: return "Ended"
    }
  }

  private func fmtDuration(_ totalSec: Int) -> String {
    let sec = max(0, totalSec)
    let h = sec / 3600
    let m = (sec % 3600) / 60
    let s = sec % 60
    if h > 0 { return String(format: "%02d:%02d:%02d", h, m, s) }
    return String(format: "%02d:%02d", m, s)
  }

  private func fmtPace(_ paceMinPerMile: Double?) -> String {
    guard let pace = paceMinPerMile, pace.isFinite, pace > 0 else { return "—" }
    let totalSec = Int(round(pace * 60.0))
    let m = totalSec / 60
    let s = totalSec % 60
    return String(format: "%d:%02d /mi", m, s)
  }

  private enum CircleStyle {
    case go
    case pause
    case end
    case endStrong
    case neutral
  }

  private func circleButton(title: String, style: CircleStyle, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(title)
        .font(.caption)
        .multilineTextAlignment(.center)
        .frame(width: 72, height: 72)
    }
    .buttonStyle(.plain)
    .background(backgroundColor(style))
    .clipShape(Circle())
  }

  private func backgroundColor(_ style: CircleStyle) -> Color {
    switch style {
    case .go: return Color.cyan.opacity(0.85)
    case .pause: return Color.orange.opacity(0.75)
    case .end: return Color.white.opacity(0.12)
    case .endStrong: return Color.white.opacity(0.28)
    case .neutral: return Color.white.opacity(0.08)
    }
  }

  private enum PendingStart: String, Hashable, Identifiable {
    case runOutdoor
    case runTreadmill
    case lift

    var id: String { rawValue }

    var title: String {
      switch self {
      case .runOutdoor: return "Outdoor Run"
      case .runTreadmill: return "Treadmill"
      case .lift: return "Lift"
      }
    }

    var accent: [Color] {
      switch self {
      case .runOutdoor:
        return [Color(red: 0.0, green: 0.85, blue: 1.0), Color(red: 0.2, green: 0.35, blue: 1.0)]
      case .runTreadmill:
        return [Color(red: 0.0, green: 0.45, blue: 0.55), Color(red: 0.05, green: 0.3, blue: 0.3)]
      case .lift:
        return [Color(red: 0.05, green: 0.35, blue: 0.6), Color(red: 0.18, green: 0.14, blue: 0.32)]
      }
    }

    func start(_ manager: WatchWorkoutManager) {
      switch self {
      case .runOutdoor: manager.startRun()
      case .runTreadmill: manager.startTreadmillRun()
      case .lift: manager.startLift()
      }
    }
  }

  private func startCountdown(_ start: PendingStart) {
    pendingStart = start
    playHaptic(.click)
  }

  private func onPauseTapped() {
    let now = nowMs()
    if let until = pauseArmedUntilMs, now <= until {
      pauseArmedUntilMs = nil
      playHaptic(.notification)
      manager.pause()
      return
    }

    pauseArmedUntilMs = now + 2600
    playHaptic(.click)
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.7) {
      if let until = pauseArmedUntilMs, nowMs() > until {
        pauseArmedUntilMs = nil
      }
    }
  }

  private func workoutTitle(_ snap: ZenithWatchSessionSnapshot) -> String {
    if snap.kind == .lift { return "Lift" }
    if snap.runEnvironment == .treadmill { return "Run (Treadmill)" }
    if snap.runEnvironment == .outdoor { return "Run (Outdoor)" }
    return "Run"
  }
}

private struct ZenithCardButtonStyle: ButtonStyle {
  let cornerRadius: CGFloat
  let scalePressed: CGFloat
  let overlayOpacity: Double

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? scalePressed : 1.0)
      .overlay(
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
          .fill(Color.black.opacity(configuration.isPressed ? overlayOpacity : 0))
      )
      .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
  }
}

private struct CountdownSheet: View {
  let label: String
  let accent: [Color]
  let onCancel: () -> Void
  let onComplete: () -> Void

  @State private var remaining: Int = 3
  @State private var timerCancellable: AnyCancellable? = nil

  private func play(_ type: WKHapticType) { WKInterfaceDevice.current().play(type) }

  var body: some View {
    ZStack {
      LinearGradient(colors: accent, startPoint: .topLeading, endPoint: .bottomTrailing)
        .ignoresSafeArea()

      VStack(spacing: 10) {
        Text(label.uppercased())
          .font(.system(.caption, design: .rounded).weight(.heavy))
          .foregroundStyle(Color.white.opacity(0.9))

        Text("\(max(0, remaining))")
          .font(.system(size: 52, weight: .heavy, design: .rounded))
          .monospacedDigit()
          .foregroundStyle(.white)

        Text("GET READY")
          .font(.system(.caption2, design: .rounded).weight(.semibold))
          .foregroundStyle(Color.white.opacity(0.85))

        Button("Cancel") {
          timerCancellable?.cancel()
          timerCancellable = nil
          play(.failure)
          onCancel()
        }
        .buttonStyle(.bordered)
        .tint(Color.white.opacity(0.18))
      }
      .padding()
    }
    .onAppear {
      remaining = 3
      play(.click)
      timerCancellable?.cancel()
      timerCancellable = Timer.publish(every: 1.0, on: .main, in: .common)
        .autoconnect()
        .sink { _ in
          remaining -= 1
          if remaining > 0 {
            play(.click)
          } else {
            timerCancellable?.cancel()
            timerCancellable = nil
            play(.start)
            onComplete()
          }
        }
    }
    .onDisappear {
      timerCancellable?.cancel()
      timerCancellable = nil
    }
  }
}

#Preview {
  ContentView()
}
