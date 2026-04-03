import Foundation
import UIKit
import SceneKit
import React
import MachO
import ObjectiveC.runtime

private let unityRegionPressNotification = Notification.Name("ZenithUnityRegionPressNotification")
private let unityBridgeGameObject = "BodyMapRuntimeBridge"

@_cdecl("ZenithUnityEmitRegionPress")
public func ZenithUnityEmitRegionPress(_ regionId: Int32, _ regionKey: UnsafePointer<CChar>?, _ score: Float) {
  let key = regionKey.map { String(cString: $0) } ?? ""
  NotificationCenter.default.post(
    name: unityRegionPressNotification,
    object: nil,
    userInfo: [
      "regionId": Int(regionId),
      "regionKey": key,
      "score": Double(score),
    ]
  )
}

@objc(BodyMap3DView)
class BodyMap3DView: UIView {
  @objc var snapshotJson: NSString? {
    didSet {
      if usingUnity {
        syncUnitySnapshot()
      } else {
        applySnapshotFromJson()
      }
    }
  }

  @objc var stimulusLensJson: NSString? {
    didSet {
      if usingUnity {
        syncUnityStimulusLens()
      }
    }
  }

  @objc var regionPanelsJson: NSString? {
    didSet {
      if usingUnity {
        syncUnityRegionPanels()
      }
    }
  }

  @objc var activeLens: NSString? {
    didSet {
      if usingUnity {
        syncUnityLensSelection()
      }
    }
  }

  @objc var overlayMode: NSString? {
    didSet {
      if usingUnity {
        syncUnityOverlayMode()
      } else {
        applySnapshotFromJson()
      }
    }
  }

  @objc var selectedRegionId: NSNumber? {
    didSet {
      if usingUnity {
        syncUnitySelection()
      } else {
        applySelection(animated: true)
      }
    }
  }

  @objc var onRegionPress: RCTBubblingEventBlock?

  private let scnView = SCNView(frame: .zero)
  private let scene = SCNScene()
  private let bodyRoot = SCNNode()

  private var regionNodes: [Int: SCNNode] = [:]
  private var regionKeys: [Int: String] = [:]
  private var regionScores: [Int: Double] = [:]
  private var cachedOverlayMode: String = "STIMULUS"

  private var usingUnity = false
  private weak var unityEmbeddedView: UIView?
  private var unityRegionObserver: NSObjectProtocol?

  override init(frame: CGRect) {
    super.init(frame: frame)
    commonInit()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    commonInit()
  }

  deinit {
    if let observer = unityRegionObserver {
      NotificationCenter.default.removeObserver(observer)
    }
  }

  private func commonInit() {
    backgroundColor = .clear

    if let unityView = UnityBodyMapRuntime.shared.attachEmbeddedView(to: self) {
      usingUnity = true
      unityEmbeddedView = unityView
      observeUnityRegionPresses()
      syncUnityState()
      return
    }

    scnView.translatesAutoresizingMaskIntoConstraints = false
    scnView.backgroundColor = UIColor(red: 0.02, green: 0.03, blue: 0.07, alpha: 1.0)
    scnView.scene = scene
    scnView.autoenablesDefaultLighting = false
    scnView.allowsCameraControl = true
    scnView.rendersContinuously = true
    scnView.antialiasingMode = .multisampling4X

    addSubview(scnView)
    NSLayoutConstraint.activate([
      scnView.leadingAnchor.constraint(equalTo: leadingAnchor),
      scnView.trailingAnchor.constraint(equalTo: trailingAnchor),
      scnView.topAnchor.constraint(equalTo: topAnchor),
      scnView.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])

    scene.rootNode.addChildNode(bodyRoot)
    buildLighting()
    buildCamera()
    buildBaseSilhouette()
    buildRegions()

    let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    scnView.addGestureRecognizer(tap)
  }

  private func syncUnityState() {
    guard usingUnity else { return }
    syncUnitySnapshot()
    syncUnityStimulusLens()
    syncUnityRegionPanels()
    syncUnityLensSelection()
    syncUnityOverlayMode()
    syncUnitySelection()
  }

  private func syncUnitySnapshot() {
    guard usingUnity else { return }
    let payload = (snapshotJson as String?) ?? "{}"
    UnityBodyMapRuntime.shared.sendMessage(method: "ApplySnapshotJson", message: payload)
  }

  private func syncUnityStimulusLens() {
    guard usingUnity else { return }
    guard let payload = stimulusLensJson as String?, !payload.isEmpty else { return }
    UnityBodyMapRuntime.shared.sendMessage(method: "ApplyStimulusLensJson", message: payload)
  }

  private func syncUnityRegionPanels() {
    guard usingUnity else { return }
    guard let payload = regionPanelsJson as String?, !payload.isEmpty else { return }
    UnityBodyMapRuntime.shared.sendMessage(method: "ApplyRegionPanelJson", message: payload)
  }

  private func syncUnityLensSelection() {
    guard usingUnity else { return }
    guard let lens = (activeLens as String?)?.trimmingCharacters(in: .whitespacesAndNewlines), !lens.isEmpty else { return }
    UnityBodyMapRuntime.shared.sendMessage(method: "ApplyStimulusLensName", message: lens)
  }

  private func syncUnityOverlayMode() {
    guard usingUnity else { return }
    guard let mode = (overlayMode as String?)?.trimmingCharacters(in: .whitespacesAndNewlines), !mode.isEmpty else { return }
    UnityBodyMapRuntime.shared.sendMessage(method: "ApplyOverlayModeName", message: mode)
  }

  private func syncUnitySelection() {
    guard usingUnity else { return }
    let regionId = selectedRegionId?.intValue ?? 0
    UnityBodyMapRuntime.shared.sendMessage(method: "SetSelectedRegionIdFromNative", message: String(regionId))
  }

  private func observeUnityRegionPresses() {
    unityRegionObserver = NotificationCenter.default.addObserver(
      forName: unityRegionPressNotification,
      object: nil,
      queue: .main
    ) { [weak self] note in
      guard let self else { return }
      guard self.usingUnity else { return }
      let userInfo = note.userInfo ?? [:]
      let id = (userInfo["regionId"] as? NSNumber)?.intValue ?? (userInfo["regionId"] as? Int) ?? 0
      let key = (userInfo["regionKey"] as? String) ?? ""
      let score = (userInfo["score"] as? NSNumber)?.doubleValue ?? (userInfo["score"] as? Double) ?? 0
      self.selectedRegionId = NSNumber(value: id)
      self.onRegionPress?([
        "regionId": id,
        "regionKey": key,
        "score": score,
      ])
    }
  }

  private func buildLighting() {
    guard !usingUnity else { return }

    let key = SCNNode()
    key.light = SCNLight()
    key.light?.type = .omni
    key.light?.color = UIColor(white: 1.0, alpha: 0.95)
    key.position = SCNVector3(2.4, 2.2, 2.6)
    scene.rootNode.addChildNode(key)

    let fill = SCNNode()
    fill.light = SCNLight()
    fill.light?.type = .omni
    fill.light?.color = UIColor(red: 0.35, green: 0.72, blue: 1.0, alpha: 0.55)
    fill.position = SCNVector3(-2.0, 1.8, 2.4)
    scene.rootNode.addChildNode(fill)

    let rim = SCNNode()
    rim.light = SCNLight()
    rim.light?.type = .omni
    rim.light?.color = UIColor(red: 0.7, green: 0.3, blue: 1.0, alpha: 0.45)
    rim.position = SCNVector3(0.0, 1.6, -2.8)
    scene.rootNode.addChildNode(rim)

    let ambient = SCNNode()
    ambient.light = SCNLight()
    ambient.light?.type = .ambient
    ambient.light?.color = UIColor(white: 0.12, alpha: 1.0)
    scene.rootNode.addChildNode(ambient)
  }

  private func buildCamera() {
    guard !usingUnity else { return }

    let camNode = SCNNode()
    camNode.camera = SCNCamera()
    camNode.camera?.fieldOfView = 48
    camNode.camera?.zNear = 0.1
    camNode.camera?.zFar = 100
    camNode.position = SCNVector3(0, 1.0, 3.6)
    scene.rootNode.addChildNode(camNode)

    let target = SCNLookAtConstraint(target: bodyRoot)
    target.isGimbalLockEnabled = true
    camNode.constraints = [target]
  }

  private func baseMaterial() -> SCNMaterial {
    let mat = SCNMaterial()
    mat.diffuse.contents = UIColor(red: 0.08, green: 0.1, blue: 0.16, alpha: 1)
    mat.roughness.contents = 0.85
    mat.metalness.contents = 0.05
    mat.lightingModel = .physicallyBased
    return mat
  }

  private func regionMaterial() -> SCNMaterial {
    let mat = SCNMaterial()
    mat.diffuse.contents = UIColor(red: 0.22, green: 0.28, blue: 0.35, alpha: 1)
    mat.emission.contents = UIColor.black
    mat.roughness.contents = 0.55
    mat.metalness.contents = 0.02
    mat.lightingModel = .physicallyBased
    return mat
  }

  private func addBaseNode(_ geometry: SCNGeometry, position: SCNVector3) {
    let node = SCNNode(geometry: geometry)
    node.position = position
    node.geometry?.materials = [baseMaterial()]
    bodyRoot.addChildNode(node)
  }

  private func addRegionNode(id: Int, key: String, geometry: SCNGeometry, position: SCNVector3) {
    let node = SCNNode(geometry: geometry)
    node.name = "region:\(id):\(key)"
    node.position = position
    node.geometry?.materials = [regionMaterial()]
    node.renderingOrder = 10
    bodyRoot.addChildNode(node)
    regionNodes[id] = node
    regionKeys[id] = key
    regionScores[id] = 0
  }

  private func buildBaseSilhouette() {
    guard !usingUnity else { return }

    addBaseNode(SCNCapsule(capRadius: 0.24, height: 0.86), position: SCNVector3(0, 0.95, 0))
    addBaseNode(SCNSphere(radius: 0.14), position: SCNVector3(0, 1.48, 0))
    addBaseNode(SCNCapsule(capRadius: 0.09, height: 0.44), position: SCNVector3(-0.43, 0.92, 0))
    addBaseNode(SCNCapsule(capRadius: 0.09, height: 0.44), position: SCNVector3(0.43, 0.92, 0))
    addBaseNode(SCNCapsule(capRadius: 0.11, height: 0.74), position: SCNVector3(-0.18, 0.26, 0))
    addBaseNode(SCNCapsule(capRadius: 0.11, height: 0.74), position: SCNVector3(0.18, 0.26, 0))
  }

  private func buildRegions() {
    guard !usingUnity else { return }

    // Chest
    addRegionNode(id: 1, key: "CHEST_L", geometry: SCNSphere(radius: 0.12), position: SCNVector3(-0.16, 1.07, 0.16))
    addRegionNode(id: 2, key: "CHEST_R", geometry: SCNSphere(radius: 0.12), position: SCNVector3(0.16, 1.07, 0.16))

    // Delts
    addRegionNode(id: 3, key: "DELTS_FRONT_L", geometry: SCNSphere(radius: 0.08), position: SCNVector3(-0.33, 1.15, 0.15))
    addRegionNode(id: 4, key: "DELTS_FRONT_R", geometry: SCNSphere(radius: 0.08), position: SCNVector3(0.33, 1.15, 0.15))
    addRegionNode(id: 5, key: "DELTS_SIDE_L", geometry: SCNSphere(radius: 0.085), position: SCNVector3(-0.40, 1.13, 0.00))
    addRegionNode(id: 6, key: "DELTS_SIDE_R", geometry: SCNSphere(radius: 0.085), position: SCNVector3(0.40, 1.13, 0.00))
    addRegionNode(id: 7, key: "DELTS_REAR_L", geometry: SCNSphere(radius: 0.08), position: SCNVector3(-0.33, 1.15, -0.15))
    addRegionNode(id: 8, key: "DELTS_REAR_R", geometry: SCNSphere(radius: 0.08), position: SCNVector3(0.33, 1.15, -0.15))

    // Arms
    addRegionNode(id: 9, key: "BICEPS_L", geometry: SCNCapsule(capRadius: 0.055, height: 0.2), position: SCNVector3(-0.46, 0.98, 0.11))
    addRegionNode(id: 10, key: "BICEPS_R", geometry: SCNCapsule(capRadius: 0.055, height: 0.2), position: SCNVector3(0.46, 0.98, 0.11))
    addRegionNode(id: 11, key: "TRICEPS_L", geometry: SCNCapsule(capRadius: 0.055, height: 0.2), position: SCNVector3(-0.46, 0.98, -0.11))
    addRegionNode(id: 12, key: "TRICEPS_R", geometry: SCNCapsule(capRadius: 0.055, height: 0.2), position: SCNVector3(0.46, 0.98, -0.11))
    addRegionNode(id: 13, key: "FOREARMS_L", geometry: SCNCapsule(capRadius: 0.048, height: 0.22), position: SCNVector3(-0.52, 0.74, 0.0))
    addRegionNode(id: 14, key: "FOREARMS_R", geometry: SCNCapsule(capRadius: 0.048, height: 0.22), position: SCNVector3(0.52, 0.74, 0.0))

    // Back + lats + traps
    addRegionNode(id: 15, key: "UPPER_BACK_L", geometry: SCNBox(width: 0.17, height: 0.17, length: 0.07, chamferRadius: 0.035), position: SCNVector3(-0.18, 1.09, -0.19))
    addRegionNode(id: 16, key: "UPPER_BACK_R", geometry: SCNBox(width: 0.17, height: 0.17, length: 0.07, chamferRadius: 0.035), position: SCNVector3(0.18, 1.09, -0.19))
    addRegionNode(id: 17, key: "LATS_L", geometry: SCNBox(width: 0.16, height: 0.20, length: 0.07, chamferRadius: 0.03), position: SCNVector3(-0.22, 0.90, -0.18))
    addRegionNode(id: 18, key: "LATS_R", geometry: SCNBox(width: 0.16, height: 0.20, length: 0.07, chamferRadius: 0.03), position: SCNVector3(0.22, 0.90, -0.18))
    addRegionNode(id: 19, key: "TRAPS_L", geometry: SCNSphere(radius: 0.07), position: SCNVector3(-0.10, 1.28, -0.12))
    addRegionNode(id: 20, key: "TRAPS_R", geometry: SCNSphere(radius: 0.07), position: SCNVector3(0.10, 1.28, -0.12))

    // Core
    addRegionNode(id: 21, key: "ABS", geometry: SCNBox(width: 0.24, height: 0.33, length: 0.07, chamferRadius: 0.03), position: SCNVector3(0, 0.92, 0.18))
    addRegionNode(id: 22, key: "OBLIQUES_L", geometry: SCNBox(width: 0.09, height: 0.25, length: 0.07, chamferRadius: 0.02), position: SCNVector3(-0.18, 0.92, 0.16))
    addRegionNode(id: 23, key: "OBLIQUES_R", geometry: SCNBox(width: 0.09, height: 0.25, length: 0.07, chamferRadius: 0.02), position: SCNVector3(0.18, 0.92, 0.16))
    addRegionNode(id: 24, key: "LOWER_BACK", geometry: SCNBox(width: 0.24, height: 0.18, length: 0.07, chamferRadius: 0.025), position: SCNVector3(0, 0.76, -0.18))

    // Hips/legs
    addRegionNode(id: 25, key: "GLUTES_L", geometry: SCNSphere(radius: 0.10), position: SCNVector3(-0.12, 0.64, -0.18))
    addRegionNode(id: 26, key: "GLUTES_R", geometry: SCNSphere(radius: 0.10), position: SCNVector3(0.12, 0.64, -0.18))
    addRegionNode(id: 27, key: "HIP_FLEXORS_L", geometry: SCNSphere(radius: 0.075), position: SCNVector3(-0.13, 0.67, 0.16))
    addRegionNode(id: 28, key: "HIP_FLEXORS_R", geometry: SCNSphere(radius: 0.075), position: SCNVector3(0.13, 0.67, 0.16))
    addRegionNode(id: 29, key: "ADDUCTORS_L", geometry: SCNCapsule(capRadius: 0.055, height: 0.2), position: SCNVector3(-0.08, 0.49, 0.12))
    addRegionNode(id: 30, key: "ADDUCTORS_R", geometry: SCNCapsule(capRadius: 0.055, height: 0.2), position: SCNVector3(0.08, 0.49, 0.12))
    addRegionNode(id: 31, key: "QUADS_L", geometry: SCNCapsule(capRadius: 0.078, height: 0.30), position: SCNVector3(-0.14, 0.34, 0.12))
    addRegionNode(id: 32, key: "QUADS_R", geometry: SCNCapsule(capRadius: 0.078, height: 0.30), position: SCNVector3(0.14, 0.34, 0.12))
    addRegionNode(id: 33, key: "HAMSTRINGS_L", geometry: SCNCapsule(capRadius: 0.074, height: 0.30), position: SCNVector3(-0.14, 0.34, -0.12))
    addRegionNode(id: 34, key: "HAMSTRINGS_R", geometry: SCNCapsule(capRadius: 0.074, height: 0.30), position: SCNVector3(0.14, 0.34, -0.12))
    addRegionNode(id: 35, key: "CALVES_L", geometry: SCNCapsule(capRadius: 0.062, height: 0.30), position: SCNVector3(-0.12, 0.04, -0.1))
    addRegionNode(id: 36, key: "CALVES_R", geometry: SCNCapsule(capRadius: 0.062, height: 0.30), position: SCNVector3(0.12, 0.04, -0.1))
    addRegionNode(id: 37, key: "TIBIALIS_L", geometry: SCNCapsule(capRadius: 0.055, height: 0.28), position: SCNVector3(-0.12, 0.04, 0.1))
    addRegionNode(id: 38, key: "TIBIALIS_R", geometry: SCNCapsule(capRadius: 0.055, height: 0.28), position: SCNVector3(0.12, 0.04, 0.1))

    // Neck
    addRegionNode(id: 39, key: "NECK", geometry: SCNCapsule(capRadius: 0.06, height: 0.15), position: SCNVector3(0, 1.33, 0.0))
  }

  @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
    guard !usingUnity else { return }

    let point = gesture.location(in: scnView)
    let hits = scnView.hitTest(point, options: [SCNHitTestOption.searchMode: SCNHitTestSearchMode.all.rawValue])

    guard let hit = hits.first(where: { $0.node.name?.hasPrefix("region:") == true }),
          let name = hit.node.name else {
      selectedRegionId = 0
      applySelection(animated: true)
      onRegionPress?(["regionId": 0, "regionKey": "", "score": 0])
      return
    }

    let comps = name.split(separator: ":")
    guard comps.count >= 3, let regionId = Int(comps[1]) else {
      return
    }
    let key = String(comps[2])
    let score = regionScores[regionId] ?? 0

    selectedRegionId = NSNumber(value: regionId)
    applySelection(animated: true)
    onRegionPress?([
      "regionId": regionId,
      "regionKey": key,
      "score": score,
    ])
  }

  private func applySnapshotFromJson() {
    guard !usingUnity else { return }

    guard let json = snapshotJson as String? else {
      return
    }

    guard let data = json.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data, options: []),
          let root = object as? [String: Any] else {
      return
    }

    let modeFromProp = (overlayMode as String?)?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    let modeFromSnapshot = String(describing: root["overlayMode"] ?? "STIMULUS").uppercased()
    cachedOverlayMode = (modeFromProp?.isEmpty == false ? modeFromProp! : modeFromSnapshot)

    guard let regions = root["regions"] as? [[String: Any]] else {
      return
    }

    var nextScores: [Int: Double] = [:]
    for row in regions {
      guard let id = row["id"] as? Int, id > 0, id < 256 else { continue }
      let key = (row["key"] as? String) ?? (regionKeys[id] ?? "")
      regionKeys[id] = key

      var score: Double = 0
      if let scores = row["scores"] as? [String: Any] {
        switch cachedOverlayMode {
        case "SORENESS": score = (scores["soreness"] as? NSNumber)?.doubleValue ?? 0
        case "PAIN": score = (scores["pain"] as? NSNumber)?.doubleValue ?? 0
        case "FATIGUE": score = (scores["fatigue"] as? NSNumber)?.doubleValue ?? 0
        case "COMPOSITE": score = (scores["composite"] as? NSNumber)?.doubleValue ?? 0
        default: score = (scores["stimulus"] as? NSNumber)?.doubleValue ?? 0
        }
      }
      nextScores[id] = max(0, min(100, score))
    }

    regionScores = nextScores
    applyColors()
    applySelection(animated: false)
  }

  private func applyColors() {
    guard !usingUnity else { return }

    CATransaction.begin()
    CATransaction.setAnimationDuration(0.24)

    for (id, node) in regionNodes {
      let score = regionScores[id] ?? 0
      let normalized = max(0.0, min(1.0, score / 100.0))
      let color = colorForIntensity(normalized)
      if let mat = node.geometry?.firstMaterial {
        mat.diffuse.contents = color.withAlphaComponent(0.96)
        mat.emission.contents = color.withAlphaComponent(0.24 + CGFloat(normalized) * 0.48)
      }
    }

    CATransaction.commit()
  }

  private func applySelection(animated: Bool) {
    guard !usingUnity else { return }

    let selectedId = selectedRegionId?.intValue ?? 0

    CATransaction.begin()
    CATransaction.setDisableActions(!animated)
    CATransaction.setAnimationDuration(animated ? 0.18 : 0.0)

    for (id, node) in regionNodes {
      let isSelected = id == selectedId && selectedId > 0
      let baseScore = regionScores[id] ?? 0
      let normalized = max(0.0, min(1.0, baseScore / 100.0))
      let baseColor = colorForIntensity(normalized)

      node.scale = isSelected ? SCNVector3(1.08, 1.08, 1.08) : SCNVector3(1, 1, 1)
      if let mat = node.geometry?.firstMaterial {
        if isSelected {
          mat.emission.contents = UIColor.white.withAlphaComponent(0.85)
          mat.diffuse.contents = blend(baseColor, UIColor.white, t: 0.2)
        } else {
          mat.diffuse.contents = baseColor.withAlphaComponent(0.96)
          mat.emission.contents = baseColor.withAlphaComponent(0.24 + CGFloat(normalized) * 0.48)
        }
      }
    }

    CATransaction.commit()
  }

  private func colorForIntensity(_ tIn: CGFloat) -> UIColor {
    let t = max(0, min(1, tIn))

    let cool = UIColor(hex: "#64748B")
    let trained = UIColor(hex: "#30D1FC")
    let high = UIColor(hex: "#F14975")
    let redline = UIColor(hex: "#FD9E33")

    if t < 0.33 {
      return blend(cool, trained, t: t / 0.33)
    }
    if t < 0.66 {
      return blend(trained, high, t: (t - 0.33) / 0.33)
    }
    return blend(high, redline, t: (t - 0.66) / 0.34)
  }

  private func blend(_ a: UIColor, _ b: UIColor, t: CGFloat) -> UIColor {
    let ta = max(0, min(1, t))
    var ar: CGFloat = 0
    var ag: CGFloat = 0
    var ab: CGFloat = 0
    var aa: CGFloat = 0
    var br: CGFloat = 0
    var bg: CGFloat = 0
    var bb: CGFloat = 0
    var ba: CGFloat = 0
    a.getRed(&ar, green: &ag, blue: &ab, alpha: &aa)
    b.getRed(&br, green: &bg, blue: &bb, alpha: &ba)

    return UIColor(
      red: ar + (br - ar) * ta,
      green: ag + (bg - ag) * ta,
      blue: ab + (bb - ab) * ta,
      alpha: aa + (ba - aa) * ta
    )
  }
}

private final class UnityBodyMapRuntime {
  static let shared = UnityBodyMapRuntime()

  private var didAttemptBoot = false
  private var didBoot = false
  private var unityFramework: NSObject?
  private weak var cachedUnityView: UIView?

  private init() {}

  func attachEmbeddedView(to parent: UIView) -> UIView? {
    guard bootIfPossible() else { return nil }
    guard let unityView = resolveUnityRenderView() else { return nil }

    if unityView.superview !== parent {
      unityView.removeFromSuperview()
      unityView.translatesAutoresizingMaskIntoConstraints = false
      parent.addSubview(unityView)
      NSLayoutConstraint.activate([
        unityView.leadingAnchor.constraint(equalTo: parent.leadingAnchor),
        unityView.trailingAnchor.constraint(equalTo: parent.trailingAnchor),
        unityView.topAnchor.constraint(equalTo: parent.topAnchor),
        unityView.bottomAnchor.constraint(equalTo: parent.bottomAnchor),
      ])
    }

    cachedUnityView = unityView
    return unityView
  }

  func sendMessage(method: String, message: String) {
    guard bootIfPossible() else { return }
    guard let ufw = unityFramework else { return }

    let selector = NSSelectorFromString("sendMessageToGOWithName:functionName:message:")
    guard ufw.responds(to: selector) else { return }

    typealias SendMessageImp = @convention(c) (AnyObject, Selector, UnsafePointer<CChar>, UnsafePointer<CChar>, UnsafePointer<CChar>) -> Void
    let imp = ufw.method(for: selector)
    let call = unsafeBitCast(imp, to: SendMessageImp.self)

    unityBridgeGameObject.withCString { gameObjectCString in
      method.withCString { methodCString in
        message.withCString { messageCString in
          call(ufw, selector, gameObjectCString, methodCString, messageCString)
        }
      }
    }
  }

  private func bootIfPossible() -> Bool {
    if didBoot { return true }
    if didAttemptBoot { return false }
    didAttemptBoot = true

    guard let frameworkBundle = unityFrameworkBundle() else { return false }
    if !frameworkBundle.isLoaded {
      frameworkBundle.load()
    }

    guard let unityClass = NSClassFromString("UnityFramework") else {
      return false
    }

    guard let ufw = (unityClass as AnyObject).perform(NSSelectorFromString("getInstance"))?.takeUnretainedValue() as? NSObject else {
      return false
    }

    configureDataBundleId(on: ufw)

    if unityAppController(of: ufw) == nil {
      setExecuteHeader(on: ufw)
      runEmbedded(on: ufw)
    }

    if unityAppController(of: ufw) == nil {
      return false
    }

    unityFramework = ufw
    didBoot = true
    return true
  }

  private func unityFrameworkBundle() -> Bundle? {
    guard let frameworksPath = Bundle.main.privateFrameworksPath else { return nil }
    let frameworkPath = (frameworksPath as NSString).appendingPathComponent("UnityFramework.framework")
    guard FileManager.default.fileExists(atPath: frameworkPath) else { return nil }
    return Bundle(path: frameworkPath)
  }

  private func unityAppController(of ufw: NSObject) -> NSObject? {
    let selector = NSSelectorFromString("appController")
    guard ufw.responds(to: selector) else { return nil }
    return ufw.perform(selector)?.takeUnretainedValue() as? NSObject
  }

  private func resolveUnityRenderView() -> UIView? {
    if let cached = cachedUnityView {
      return cached
    }

    guard let ufw = unityFramework else { return nil }
    guard let appController = unityAppController(of: ufw) else { return nil }

    let rootVCSelector = NSSelectorFromString("rootViewController")
    guard appController.responds(to: rootVCSelector),
          let rootVC = appController.perform(rootVCSelector)?.takeUnretainedValue() as? UIViewController else {
      return nil
    }

    return rootVC.view
  }

  private func configureDataBundleId(on ufw: NSObject) {
    let selector = NSSelectorFromString("setDataBundleId:")
    guard ufw.responds(to: selector) else { return }

    typealias SetDataBundleImp = @convention(c) (AnyObject, Selector, UnsafePointer<CChar>) -> Void
    let imp = ufw.method(for: selector)
    let call = unsafeBitCast(imp, to: SetDataBundleImp.self)
    "com.unity3d.framework".withCString { cString in
      call(ufw, selector, cString)
    }
  }

  private func setExecuteHeader(on ufw: NSObject) {
    let selector = NSSelectorFromString("setExecuteHeader:")
    guard ufw.responds(to: selector) else { return }

    typealias SetHeaderImp = @convention(c) (AnyObject, Selector, UnsafeRawPointer) -> Void
    let imp = ufw.method(for: selector)
    let call = unsafeBitCast(imp, to: SetHeaderImp.self)
    guard let header = _dyld_get_image_header(0) else { return }
    call(ufw, selector, UnsafeRawPointer(header))
  }

  private func runEmbedded(on ufw: NSObject) {
    let selector = NSSelectorFromString("runEmbeddedWithArgc:argv:appLaunchOpts:")
    guard ufw.responds(to: selector) else { return }

    typealias RunEmbeddedImp = @convention(c) (AnyObject, Selector, Int32, UnsafeMutablePointer<UnsafeMutablePointer<Int8>?>?, NSDictionary?) -> Void
    let imp = ufw.method(for: selector)
    let call = unsafeBitCast(imp, to: RunEmbeddedImp.self)
    call(ufw, selector, 0, nil, nil)
  }
}

private extension UIColor {
  convenience init(hex: String) {
    let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    var int: UInt64 = 0
    Scanner(string: cleaned).scanHexInt64(&int)
    let r: UInt64
    let g: UInt64
    let b: UInt64
    switch cleaned.count {
    case 3:
      (r, g, b) = ((int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
    case 6:
      (r, g, b) = (int >> 16, int >> 8 & 0xFF, int & 0xFF)
    default:
      (r, g, b) = (0x64, 0x74, 0x8B)
    }
    self.init(red: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: 1)
  }
}
