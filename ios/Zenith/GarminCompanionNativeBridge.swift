import Foundation
import React

@objc(GarminCompanionNativeBridge)
class GarminCompanionNativeBridge: NSObject {
  @objc(startListening:rejecter:)
  func startListening(
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(GarminCompanionManager.shared.startListening())
  }

  @objc(stopListening:rejecter:)
  func stopListening(
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(GarminCompanionManager.shared.stopListening())
  }

  @objc(sendMessage:resolver:rejecter:)
  func sendMessage(
    _ payload: [String: Any],
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(GarminCompanionManager.shared.sendMessage(payload))
  }

  @objc(requestEntitlementRefresh:rejecter:)
  func requestEntitlementRefresh(
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(GarminCompanionManager.shared.requestEntitlementRefresh())
  }

  @objc(getConnectionState:rejecter:)
  func getConnectionState(
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(GarminCompanionManager.shared.getConnectionState())
  }
}
