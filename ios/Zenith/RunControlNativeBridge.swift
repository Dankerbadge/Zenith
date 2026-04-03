import Foundation
import React

@objc(RunControlNativeBridge)
class RunControlNativeBridge: NSObject {
  @objc(startLiveActivity:resolver:rejecter:)
  func startLiveActivity(
    _ payload: [String: Any],
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let sessionId = payload["sessionId"] as? String else {
      reject("ERR_SESSION", "sessionId is required", nil)
      return
    }
    if #available(iOS 16.1, *) {
      Task {
        await RunLiveActivityManager.shared.start(sessionId: sessionId, payload: payload)
        resolve(true)
      }
      return
    }
    resolve(false)
  }

  @objc(updateLiveActivity:resolver:rejecter:)
  func updateLiveActivity(
    _ payload: [String: Any],
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let sessionId = payload["sessionId"] as? String else {
      reject("ERR_SESSION", "sessionId is required", nil)
      return
    }
    if #available(iOS 16.1, *) {
      Task {
        await RunLiveActivityManager.shared.update(sessionId: sessionId, payload: payload)
        resolve(true)
      }
      return
    }
    resolve(false)
  }

  @objc(endLiveActivity:resolver:rejecter:)
  func endLiveActivity(
    _ payload: [String: Any],
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let sessionId = payload["sessionId"] as? String
    if #available(iOS 16.1, *) {
      Task {
        await RunLiveActivityManager.shared.end(sessionId: sessionId)
        resolve(true)
      }
      return
    }
    resolve(false)
  }

  @objc(sendWatchCommand:resolver:rejecter:)
  func sendWatchCommand(
    _ payload: [String: Any],
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    RunConnectivityManager.shared.sendCommand(payload)
    resolve(true)
  }

  @objc(sendTreadmillCalibrationFactor:resolver:rejecter:)
  func sendTreadmillCalibrationFactor(
    _ factor: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    RunConnectivityManager.shared.sendTreadmillCalibrationFactor(factor.doubleValue)
    resolve(true)
  }

  @objc(sendTreadmillCalibrationUpdate:resolver:rejecter:)
  func sendTreadmillCalibrationUpdate(
    _ payload: [String: Any],
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    RunConnectivityManager.shared.sendTreadmillCalibrationUpdate(payload)
    resolve(true)
  }
}
