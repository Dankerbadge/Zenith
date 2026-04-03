import Foundation
import React

@objc(LiftControlNativeBridge)
class LiftControlNativeBridge: NSObject {
  // Lift Live Activity is intentionally not implemented in P0; keep promises resolved without side effects.
  @objc(startLiftLiveActivity:resolver:rejecter:)
  func startLiftLiveActivity(
    _ payload: [String: Any],
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(false)
  }

  @objc(updateLiftLiveActivity:resolver:rejecter:)
  func updateLiftLiveActivity(
    _ payload: [String: Any],
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(false)
  }

  @objc(endLiftLiveActivity:resolver:rejecter:)
  func endLiftLiveActivity(
    _ payload: [String: Any],
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(false)
  }

  @objc(sendLiftWatchCommand:resolver:rejecter:)
  func sendLiftWatchCommand(
    _ payload: [String: Any],
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    // Ensure kind is present so the watch and phone routing is deterministic.
    var next = payload
    if next["kind"] == nil { next["kind"] = "lift" }
    RunConnectivityManager.shared.sendCommand(next)
    resolve(true)
  }
}
