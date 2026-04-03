//
//  ZenithRunLiveActivityIntents.swift
//  ZenithWidgets
//
//  Live Activity action intents. These must be local-first and should never depend on network services.
//  They send commands to the paired Apple Watch and (when needed) update a UI-only "armed" indicator.
//

import ActivityKit
import AppIntents
import Foundation
import WatchConnectivity

private enum ZenithRunCommandType: String {
  case pause = "pause"
  case resume = "resume"
  case requestEnd = "requestEnd"
  case confirmEnd = "confirmEnd"
}

private final class ZenithRunWatchCommandSender: NSObject, WCSessionDelegate {
  static let shared = ZenithRunWatchCommandSender()
  private override init() {
    super.init()
    if WCSession.isSupported() {
      WCSession.default.delegate = self
      WCSession.default.activate()
    }
  }

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
  func sessionDidBecomeInactive(_ session: WCSession) {}
  func sessionDidDeactivate(_ session: WCSession) {
    WCSession.default.activate()
  }

  func send(sessionId: String, commandType: ZenithRunCommandType) async throws {
    guard WCSession.isSupported() else { throw NSError(domain: "zenith.watch", code: 1) }
    let session = WCSession.default
    guard session.isPaired, session.isWatchAppInstalled else { throw NSError(domain: "zenith.watch", code: 2) }

    let payload: [String: Any] = [
      "kind": "run",
      "sessionId": sessionId,
      "commandType": commandType.rawValue,
      "clientCommandId": "la_\(commandType.rawValue)_\(Int(Date().timeIntervalSince1970 * 1000))",
      "sentAtPhone": ISO8601DateFormatter().string(from: Date()),
      "phoneLastSeqKnown": 0
    ]

    try await withCheckedThrowingContinuation { cont in
      session.sendMessage(
        ["type": "COMMAND_REQUEST", "payload": payload],
        replyHandler: { _ in cont.resume() },
        errorHandler: { err in cont.resume(throwing: err) }
      )
    }
  }
}

struct ZenithRunPauseIntent: AppIntent {
  static var title: LocalizedStringResource = "Pause run"

  @Parameter(title: "Session Id")
  var sessionId: String

  init() {}
  init(sessionId: String) {
    self.sessionId = sessionId
  }

  func perform() async throws -> some IntentResult {
    try await ZenithRunWatchCommandSender.shared.send(sessionId: sessionId, commandType: .pause)
    return .result()
  }
}

struct ZenithRunResumeIntent: AppIntent {
  static var title: LocalizedStringResource = "Resume run"

  @Parameter(title: "Session Id")
  var sessionId: String

  init() {}
  init(sessionId: String) {
    self.sessionId = sessionId
  }

  func perform() async throws -> some IntentResult {
    try await ZenithRunWatchCommandSender.shared.send(sessionId: sessionId, commandType: .resume)
    return .result()
  }
}

// Arms end confirmation for ~2.5s by updating the Live Activity's UI-only indicator,
// then requests the watch to enter endingConfirm.
struct ZenithRunArmEndIntent: AppIntent {
  static var title: LocalizedStringResource = "Arm end run"

  @Parameter(title: "Session Id")
  var sessionId: String

  // Snapshot fields needed to preserve UI state during an arm update.
  @Parameter(title: "State")
  var state: String

  @Parameter(title: "Elapsed Time")
  var elapsedTimeSec: Int

  @Parameter(title: "Moving Time")
  var movingTimeSec: Int

  @Parameter(title: "Paused Total")
  var pausedTotalSec: Int

  @Parameter(title: "Distance Miles")
  var totalDistanceMiles: Double

  @Parameter(title: "Pace Min Per Mile")
  var paceMinPerMile: Double?

  @Parameter(title: "Seq")
  var seq: Int

  @Parameter(title: "Last Updated")
  var lastUpdatedAtWatch: String

  init() {}
  init(
    sessionId: String,
    state: String,
    elapsedTimeSec: Int,
    movingTimeSec: Int,
    pausedTotalSec: Int,
    totalDistanceMiles: Double,
    paceMinPerMile: Double?,
    seq: Int,
    lastUpdatedAtWatch: String
  ) {
    self.sessionId = sessionId
    self.state = state
    self.elapsedTimeSec = elapsedTimeSec
    self.movingTimeSec = movingTimeSec
    self.pausedTotalSec = pausedTotalSec
    self.totalDistanceMiles = totalDistanceMiles
    self.paceMinPerMile = paceMinPerMile
    self.seq = seq
    self.lastUpdatedAtWatch = lastUpdatedAtWatch
  }

  func perform() async throws -> some IntentResult {
    // Update UI-only armed state (expires on its own; UI computes expiry).
    if #available(iOS 16.1, *) {
      if let activity = Activity<ZenithRunAttributes>.activities.first(where: { $0.attributes.sessionId == sessionId }) {
        let next = ZenithRunAttributes.ContentState(
          state: state,
          elapsedTimeSec: elapsedTimeSec,
          movingTimeSec: movingTimeSec,
          pausedTotalSec: pausedTotalSec,
          totalDistanceMiles: totalDistanceMiles,
          paceMinPerMile: paceMinPerMile,
          seq: seq,
          lastUpdatedAtWatch: lastUpdatedAtWatch,
          uiEndArmedUntilEpochMs: Int64(Date().timeIntervalSince1970 * 1000) + 2500
        )
        await activity.update(using: next)
      }
    }
    try await ZenithRunWatchCommandSender.shared.send(sessionId: sessionId, commandType: .requestEnd)
    return .result()
  }
}

struct ZenithRunConfirmEndIntent: AppIntent {
  static var title: LocalizedStringResource = "Confirm end run"

  @Parameter(title: "Session Id")
  var sessionId: String

  init() {}
  init(sessionId: String) {
    self.sessionId = sessionId
  }

  func perform() async throws -> some IntentResult {
    try await ZenithRunWatchCommandSender.shared.send(sessionId: sessionId, commandType: .confirmEnd)
    return .result()
  }
}
