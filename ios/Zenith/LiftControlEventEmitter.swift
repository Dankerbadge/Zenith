import Foundation
import React

@objc(LiftControlEventEmitter)
class LiftControlEventEmitter: RCTEventEmitter {
  static weak var shared: LiftControlEventEmitter?
  fileprivate var hasListeners = false

  override init() {
    super.init()
    LiftControlEventEmitter.shared = self
  }

  override class func requiresMainQueueSetup() -> Bool {
    true
  }

  override func supportedEvents() -> [String]! {
    ["LiftControlCommandRequest", "LiftControlStateUpdate", "LiftControlConnectivity", "LiftControlFinalize"]
  }

  override func startObserving() {
    hasListeners = true
    RunConnectivityManager.shared.flushPendingLiftFinalizes()
  }

  override func stopObserving() {
    hasListeners = false
  }

  static func hasListenersNow() -> Bool {
    return LiftControlEventEmitter.shared?.hasListeners == true
  }

  static func emit(_ name: String, body: [String: Any]) {
    DispatchQueue.main.async {
      guard let emitter = LiftControlEventEmitter.shared, emitter.hasListeners else { return }
      emitter.sendEvent(withName: name, body: body)
    }
  }
}
