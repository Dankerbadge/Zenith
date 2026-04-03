import Foundation
import WatchConnectivity

class RunConnectivityManager: NSObject, WCSessionDelegate {
  static let shared = RunConnectivityManager()
  private override init() {
    super.init()
  }

  // If FINALIZE arrives while JS listeners are not attached, we persist it and flush on next observe.
  private let pendingRunFinalizesKey = "zenith_pending_run_finalizes_v1"
  private let pendingLiftFinalizesKey = "zenith_pending_lift_finalizes_v1"

  func start() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    session.activate()
  }

  func flushPendingRunFinalizes() {
    let rows = (UserDefaults.standard.array(forKey: pendingRunFinalizesKey) as? [[String: Any]]) ?? []
    if rows.isEmpty { return }
    UserDefaults.standard.removeObject(forKey: pendingRunFinalizesKey)
    rows.forEach { RunControlEventEmitter.emit("RunControlFinalize", body: $0) }
  }

  func flushPendingLiftFinalizes() {
    let rows = (UserDefaults.standard.array(forKey: pendingLiftFinalizesKey) as? [[String: Any]]) ?? []
    if rows.isEmpty { return }
    UserDefaults.standard.removeObject(forKey: pendingLiftFinalizesKey)
    rows.forEach { LiftControlEventEmitter.emit("LiftControlFinalize", body: $0) }
  }

  func sendCommand(_ payload: [String: Any]) {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.isPaired, session.isWatchAppInstalled else { return }
    let kind = String(describing: payload["kind"] ?? "run")
    let clientCommandId = payload["clientCommandId"]
    session.sendMessage(
      ["type": "COMMAND_REQUEST", "payload": payload],
      replyHandler: { reply in
        // Echo clientCommandId back to JS so pending commands can be cleared deterministically.
        var merged = reply
        if let clientCommandId = clientCommandId { merged["clientCommandId"] = clientCommandId }
        if kind == "lift" {
          LiftControlEventEmitter.emit("LiftControlStateUpdate", body: merged)
        } else {
          RunControlEventEmitter.emit("RunControlStateUpdate", body: merged)
        }
      },
      errorHandler: { error in
        if kind == "lift" {
          LiftControlEventEmitter.emit("LiftControlConnectivity", body: [
            "connected": false,
            "message": error.localizedDescription
          ])
        } else {
          RunControlEventEmitter.emit("RunControlConnectivity", body: [
            "connected": false,
            "message": error.localizedDescription
          ])
        }
      }
    )
  }

  func sendTreadmillCalibrationFactor(_ factor: Double) {
    let nonce = "nonce_\(Int64(Date().timeIntervalSince1970 * 1000))_\(Int.random(in: 1000...9999))"
    sendTreadmillCalibrationUpdate([
      "factor": factor,
      "updatedAtUtc": ISO8601DateFormatter().string(from: Date()),
      "nonce": nonce,
    ])
  }

  func sendTreadmillCalibrationUpdate(_ update: [String: Any]) {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.isPaired, session.isWatchAppInstalled else { return }
    let factor = (update["factor"] as? NSNumber)?.doubleValue ?? Double(String(describing: update["factor"] ?? "")) ?? 1.0
    guard factor.isFinite, factor >= 0.70, factor <= 1.30 else { return }
    let updatedAtUtc = (update["updatedAtUtc"] as? String) ?? ISO8601DateFormatter().string(from: Date())
    let nonce = (update["nonce"] as? String) ?? "nonce_\(Int64(Date().timeIntervalSince1970 * 1000))"
    let sourceSessionId = update["sourceSessionId"]

    // WatchConnectivity requires property-list safe values. Never include Swift Optionals (`as Any`)
    // in the payload because WCSession will crash when serializing.
    var innerPayload: [String: Any] = [
      "factor": factor,
      "updatedAtUtc": updatedAtUtc,
      "nonce": nonce,
    ]
    let sourceSessionIdString = String(describing: sourceSessionId ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if !sourceSessionIdString.isEmpty, sourceSessionIdString != "nil" {
      innerPayload["sourceSessionId"] = sourceSessionIdString
    }

    let payload: [String: Any] = [
      "type": "TREADMILL_CALIBRATION_UPDATE",
      "payload": innerPayload,
    ]

    // Background-safe delivery.
    session.transferUserInfo(payload)
    // Best-effort low-latency delivery.
    if session.isReachable {
      session.sendMessage(
        payload,
        replyHandler: { [weak self] reply in
          self?.handleInboundMessage(reply)
        },
        errorHandler: nil
      )
    }
  }

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    RunControlEventEmitter.emit("RunControlConnectivity", body: [
      "connected": error == nil,
      "state": activationState.rawValue,
      "message": error?.localizedDescription ?? ""
    ])
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}
  func sessionDidDeactivate(_ session: WCSession) {
    WCSession.default.activate()
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String : Any] = [:]) {
    // Background-safe delivery path from watch.
    handleInboundMessage(userInfo)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    _ = handleInboundMessage(message)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String : Any], replyHandler: @escaping ([String : Any]) -> Void) {
    let response = handleInboundMessage(message)
    replyHandler(response ?? ["accepted": true])
  }

  @discardableResult
  private func handleInboundMessage(_ message: [String: Any]) -> [String: Any]? {
    guard let type = message["type"] as? String else { return nil }

    if type == "WATCH_PERMISSION_CHECK" {
      // Minimal contract: acknowledge receipt so Watch can treat this as a sync request.
      RunControlEventEmitter.emit("RunControlWatchPermissionCheck", body: message["payload"] as? [String: Any] ?? [:])
      return ["type": "WATCH_PERMISSION_CHECK_ACK", "payload": ["receivedAtUtc": ISO8601DateFormatter().string(from: Date())]]
    }

    if type == "TREADMILL_CALIBRATION_ACK", let payload = message["payload"] as? [String: Any] {
      RunControlEventEmitter.emit("RunControlCalibrationAck", body: payload)
      return nil
    }

    if type == "COMMAND_REQUEST", let payload = message["payload"] as? [String: Any] {
      let kind = String(describing: payload["kind"] ?? "run")
      if kind == "lift" { LiftControlEventEmitter.emit("LiftControlCommandRequest", body: payload) }
      else { RunControlEventEmitter.emit("RunControlCommandRequest", body: payload) }
      return nil
    }

    if type == "STATE_UPDATE", let payload = message["payload"] as? [String: Any] {
      let kind = String(describing: payload["kind"] ?? "run")
      if kind == "lift" {
        LiftControlEventEmitter.emit("LiftControlStateUpdate", body: payload)
      } else {
        RunControlEventEmitter.emit("RunControlStateUpdate", body: payload)
        // Keep Live Activity updated even if JS is not running.
        if #available(iOS 16.1, *) {
          let sessionId = String(describing: payload["sessionId"] ?? "")
          let state = String(describing: payload["state"] ?? "")
          let seq = payload["seq"] as? NSNumber
          Task {
            if state == "recording", (seq?.intValue ?? 0) <= 1 {
              await RunLiveActivityManager.shared.start(sessionId: sessionId, payload: payload)
            } else {
              await RunLiveActivityManager.shared.update(sessionId: sessionId, payload: payload)
            }
          }
        }
      }
      return nil
    }

    if type == "FINALIZE", let payload = message["payload"] as? [String: Any] {
      let kind = String(describing: payload["kind"] ?? "run")
      if kind == "lift" {
        if LiftControlEventEmitter.hasListenersNow() {
          LiftControlEventEmitter.emit("LiftControlFinalize", body: payload)
        } else {
          let existing = (UserDefaults.standard.array(forKey: pendingLiftFinalizesKey) as? [[String: Any]]) ?? []
          UserDefaults.standard.set(Array((existing + [payload]).suffix(20)), forKey: pendingLiftFinalizesKey)
        }
      } else {
        if RunControlEventEmitter.hasListenersNow() {
          RunControlEventEmitter.emit("RunControlFinalize", body: payload)
        } else {
          let existing = (UserDefaults.standard.array(forKey: pendingRunFinalizesKey) as? [[String: Any]]) ?? []
          UserDefaults.standard.set(Array((existing + [payload]).suffix(20)), forKey: pendingRunFinalizesKey)
        }
        if #available(iOS 16.1, *) {
          Task { await RunLiveActivityManager.shared.end(sessionId: String(describing: payload["sessionId"] ?? "")) }
        }
      }
    }
    return nil
  }
}
