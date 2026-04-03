import Foundation

final class GarminCompanionManager {
  static let shared = GarminCompanionManager()

  private var state: [String: Any] = [
    "state": "disconnected",
    "isListening": false,
    "lastError": NSNull(),
    "timestamp": ISO8601DateFormatter().string(from: Date())
  ]

  private init() {}

  func startListening() -> Bool {
    state["isListening"] = true
    state["state"] = "connected"
    state["lastError"] = NSNull()
    state["timestamp"] = ISO8601DateFormatter().string(from: Date())
    GarminCompanionEventEmitter.emit("GarminCompanionStateUpdate", body: state)
    return true
  }

  func stopListening() -> Bool {
    state["isListening"] = false
    state["state"] = "disconnected"
    state["timestamp"] = ISO8601DateFormatter().string(from: Date())
    GarminCompanionEventEmitter.emit("GarminCompanionStateUpdate", body: state)
    return true
  }

  func sendMessage(_ payload: [String: Any]) -> Bool {
    var echo: [String: Any] = payload
    echo["timestamp"] = ISO8601DateFormatter().string(from: Date())
    echo["status"] = "received"
    GarminCompanionEventEmitter.emit("GarminCompanionMessage", body: echo)
    return true
  }

  func requestEntitlementRefresh() -> Bool {
    GarminCompanionEventEmitter.emit("GarminCompanionMessage", body: [
      "type": "ENTITLEMENT_REFRESH_REQUESTED",
      "timestamp": ISO8601DateFormatter().string(from: Date()),
      "status": "queued"
    ])
    return true
  }

  func getConnectionState() -> [String: Any] {
    return state
  }
}
