import Foundation
import ActivityKit

@available(iOS 16.1, *)
struct ZenithRunAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var state: String
    var elapsedTimeSec: Int
    var movingTimeSec: Int
    var pausedTotalSec: Int
    var totalDistanceMiles: Double
    var paceMinPerMile: Double?
    var seq: Int
    var lastUpdatedAtWatch: String
    // UI-only helper for Live Activity end confirmation. This should never change workout truth.
    // When unset, treat as 0 (not armed).
    var uiEndArmedUntilEpochMs: Int64?
  }

  var sessionId: String
}

class RunLiveActivityManager {
  static let shared = RunLiveActivityManager()
  private init() {}

  @available(iOS 16.1, *)
  func start(sessionId: String, payload: [String: Any]) async {
    let current = Activity<ZenithRunAttributes>.activities.first(where: { $0.attributes.sessionId == sessionId })
    if current != nil {
      await update(sessionId: sessionId, payload: payload)
      return
    }

    let attributes = ZenithRunAttributes(sessionId: sessionId)
    let state = contentState(from: payload)
    do {
      _ = try Activity.request(attributes: attributes, contentState: state, pushType: nil)
    } catch {
      print("Failed to start Live Activity: \(error.localizedDescription)")
    }
  }

  @available(iOS 16.1, *)
  func update(sessionId: String, payload: [String: Any]) async {
    guard let activity = Activity<ZenithRunAttributes>.activities.first(where: { $0.attributes.sessionId == sessionId }) else { return }
    let state = contentState(from: payload)
    await activity.update(using: state)
  }

  @available(iOS 16.1, *)
  func end(sessionId: String?) async {
    let target = Activity<ZenithRunAttributes>.activities.filter { sessionId == nil || $0.attributes.sessionId == sessionId }
    for activity in target {
      await activity.end(using: nil, dismissalPolicy: .immediate)
    }
  }

  @available(iOS 16.1, *)
  private func contentState(from payload: [String: Any]) -> ZenithRunAttributes.ContentState {
    let elapsed = (payload["elapsedTimeSec"] as? NSNumber) ?? 0
    let moving = (payload["movingTimeSec"] as? NSNumber) ?? 0
    let paused = (payload["pausedTotalSec"] as? NSNumber) ?? 0
    let distance = (payload["totalDistanceMiles"] as? NSNumber) ?? 0
    let seq = (payload["seq"] as? NSNumber) ?? 0
    let armedUntil = (payload["uiEndArmedUntilEpochMs"] as? NSNumber)?.int64Value
    return ZenithRunAttributes.ContentState(
      state: String(describing: payload["state"] ?? "recording"),
      elapsedTimeSec: Int(truncating: elapsed),
      movingTimeSec: Int(truncating: moving),
      pausedTotalSec: Int(truncating: paused),
      totalDistanceMiles: Double(truncating: distance),
      paceMinPerMile: (payload["paceMinPerMile"] as? NSNumber)?.doubleValue,
      seq: Int(truncating: seq),
      lastUpdatedAtWatch: String(describing: payload["lastUpdatedAtWatch"] ?? ""),
      uiEndArmedUntilEpochMs: armedUntil
    )
  }
}
