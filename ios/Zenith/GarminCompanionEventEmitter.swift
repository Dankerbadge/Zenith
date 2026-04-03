import Foundation
import React

@objc(GarminCompanionEventEmitter)
class GarminCompanionEventEmitter: RCTEventEmitter {
  static weak var shared: GarminCompanionEventEmitter?
  fileprivate var hasListeners = false

  override init() {
    super.init()
    GarminCompanionEventEmitter.shared = self
  }

  override class func requiresMainQueueSetup() -> Bool {
    true
  }

  override func supportedEvents() -> [String]! {
    ["GarminCompanionStateUpdate", "GarminCompanionMessage", "GarminCompanionError"]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
  }

  static func emit(_ name: String, body: [String: Any]) {
    DispatchQueue.main.async {
      guard let emitter = GarminCompanionEventEmitter.shared, emitter.hasListeners else { return }
      emitter.sendEvent(withName: name, body: body)
    }
  }
}
