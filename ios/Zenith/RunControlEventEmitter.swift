import Foundation
import React

@objc(RunControlEventEmitter)
class RunControlEventEmitter: RCTEventEmitter {
  static weak var shared: RunControlEventEmitter?
  fileprivate var hasListeners = false

  override init() {
    super.init()
    RunControlEventEmitter.shared = self
  }

  override class func requiresMainQueueSetup() -> Bool {
    true
  }

  override func supportedEvents() -> [String]! {
    ["RunControlCommandRequest", "RunControlStateUpdate", "RunControlConnectivity", "RunControlFinalize", "RunControlCalibrationAck"]
  }

  override func startObserving() {
    hasListeners = true
    RunConnectivityManager.shared.flushPendingRunFinalizes()
  }

  override func stopObserving() {
    hasListeners = false
  }

  static func hasListenersNow() -> Bool {
    return RunControlEventEmitter.shared?.hasListeners == true
  }

  static func emit(_ name: String, body: [String: Any]) {
    DispatchQueue.main.async {
      guard let emitter = RunControlEventEmitter.shared, emitter.hasListeners else { return }
      emitter.sendEvent(withName: name, body: body)
    }
  }
}
