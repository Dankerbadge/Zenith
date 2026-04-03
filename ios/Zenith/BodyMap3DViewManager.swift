import Foundation
import React

@objc(BodyMap3DViewManager)
class BodyMap3DViewManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool {
    true
  }

  override func view() -> UIView! {
    BodyMap3DView()
  }
}
