import Foundation
import UIKit
import SceneKit
import React

private struct BodyMapRegionDefinition {
  let id: Int
  let key: String
}

private let regionDefinitions: [BodyMapRegionDefinition] = [
  BodyMapRegionDefinition(id: 1, key: "CHEST_L"),
  BodyMapRegionDefinition(id: 2, key: "CHEST_R"),
  BodyMapRegionDefinition(id: 3, key: "DELTS_FRONT_L"),
  BodyMapRegionDefinition(id: 4, key: "DELTS_FRONT_R"),
  BodyMapRegionDefinition(id: 5, key: "DELTS_SIDE_L"),
  BodyMapRegionDefinition(id: 6, key: "DELTS_SIDE_R"),
  BodyMapRegionDefinition(id: 7, key: "DELTS_REAR_L"),
  BodyMapRegionDefinition(id: 8, key: "DELTS_REAR_R"),
  BodyMapRegionDefinition(id: 9, key: "BICEPS_L"),
  BodyMapRegionDefinition(id: 10, key: "BICEPS_R"),
  BodyMapRegionDefinition(id: 11, key: "TRICEPS_L"),
  BodyMapRegionDefinition(id: 12, key: "TRICEPS_R"),
  BodyMapRegionDefinition(id: 13, key: "FOREARMS_L"),
  BodyMapRegionDefinition(id: 14, key: "FOREARMS_R"),
  BodyMapRegionDefinition(id: 15, key: "UPPER_BACK_L"),
  BodyMapRegionDefinition(id: 16, key: "UPPER_BACK_R"),
  BodyMapRegionDefinition(id: 17, key: "LATS_L"),
  BodyMapRegionDefinition(id: 18, key: "LATS_R"),
  BodyMapRegionDefinition(id: 19, key: "TRAPS_L"),
  BodyMapRegionDefinition(id: 20, key: "TRAPS_R"),
  BodyMapRegionDefinition(id: 21, key: "ABS"),
  BodyMapRegionDefinition(id: 22, key: "OBLIQUES_L"),
  BodyMapRegionDefinition(id: 23, key: "OBLIQUES_R"),
  BodyMapRegionDefinition(id: 24, key: "LOWER_BACK"),
  BodyMapRegionDefinition(id: 25, key: "GLUTES_L"),
  BodyMapRegionDefinition(id: 26, key: "GLUTES_R"),
  BodyMapRegionDefinition(id: 27, key: "HIP_FLEXORS_L"),
  BodyMapRegionDefinition(id: 28, key: "HIP_FLEXORS_R"),
  BodyMapRegionDefinition(id: 29, key: "ADDUCTORS_L"),
  BodyMapRegionDefinition(id: 30, key: "ADDUCTORS_R"),
  BodyMapRegionDefinition(id: 31, key: "QUADS_L"),
  BodyMapRegionDefinition(id: 32, key: "QUADS_R"),
  BodyMapRegionDefinition(id: 33, key: "HAMSTRINGS_L"),
  BodyMapRegionDefinition(id: 34, key: "HAMSTRINGS_R"),
  BodyMapRegionDefinition(id: 35, key: "CALVES_L"),
  BodyMapRegionDefinition(id: 36, key: "CALVES_R"),
  BodyMapRegionDefinition(id: 37, key: "TIBIALIS_L"),
  BodyMapRegionDefinition(id: 38, key: "TIBIALIS_R"),
  BodyMapRegionDefinition(id: 39, key: "NECK"),
]

private let regionIdByKey: [String: Int] = {
  var map: [String: Int] = [:]
  for definition in regionDefinitions {
    map[definition.key] = definition.id
  }
  return map
}()

private let regionKeyById: [Int: String] = {
  var map: [Int: String] = [:]
  for definition in regionDefinitions {
    map[definition.id] = definition.key
  }
  return map
}()

@objc(BodyMap3DView)
class BodyMap3DView: UIView {
  @objc var snapshotJson: NSString? {
    didSet { applySnapshotFromJson() }
  }

  // Kept for bridge compatibility; SceneKit renderer currently consumes `snapshotJson`.
  @objc var stimulusLensJson: NSString?
  @objc var regionPanelsJson: NSString?
  @objc var activeLens: NSString?

  @objc var overlayMode: NSString? {
    didSet { applySnapshotFromJson() }
  }

  @objc var cameraPreset: NSString? {
    didSet { applyCameraPreset(animated: true) }
  }

  @objc var selectedRegionId: NSNumber? {
    didSet { applySelection(animated: true) }
  }

  @objc var onRegionPress: RCTBubblingEventBlock?
  @objc var onInteractionStateChange: RCTBubblingEventBlock?

  private let scnView = SCNView(frame: .zero)
  private let scene = SCNScene()
  private let bodyRoot = SCNNode()
  private let cameraNode = SCNNode()

  private var regionNodes: [Int: SCNNode] = [:]
  private var regionKeys: [Int: String] = [:]
  private var regionScores: [Int: Double] = [:]
  private var cachedOverlayMode: String = "STIMULUS"
  private var orbitYaw: Float = 0
  private var isOrbitGestureActive = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    commonInit()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    commonInit()
  }

  private func commonInit() {
    backgroundColor = .clear

    scnView.translatesAutoresizingMaskIntoConstraints = false
    scnView.backgroundColor = UIColor(red: 0.02, green: 0.03, blue: 0.07, alpha: 1.0)
    scnView.scene = scene
    scnView.autoenablesDefaultLighting = false
    scnView.allowsCameraControl = false
    scnView.rendersContinuously = false
    scnView.antialiasingMode = .multisampling4X

    addSubview(scnView)
    NSLayoutConstraint.activate([
      scnView.leadingAnchor.constraint(equalTo: leadingAnchor),
      scnView.trailingAnchor.constraint(equalTo: trailingAnchor),
      scnView.topAnchor.constraint(equalTo: topAnchor),
      scnView.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])

    scene.rootNode.addChildNode(bodyRoot)
    seedRegionMaps()
    buildLighting()
    buildCamera()

    if !loadBundledSceneIfAvailable() {
      buildBaseSilhouette()
      buildRegions()
    }

    let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    scnView.addGestureRecognizer(tap)
    let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
    pan.minimumNumberOfTouches = 1
    pan.maximumNumberOfTouches = 1
    pan.cancelsTouchesInView = true
    scnView.addGestureRecognizer(pan)

    applyCameraPreset(animated: false)
    applySnapshotFromJson()
  }

  private func seedRegionMaps() {
    regionNodes.removeAll()
    regionKeys.removeAll()
    regionScores.removeAll()
    for region in regionDefinitions {
      regionKeys[region.id] = region.key
      regionScores[region.id] = 0
    }
  }

  private func buildLighting() {
    let key = SCNNode()
    key.light = SCNLight()
    key.light?.type = .omni
    key.light?.color = UIColor(white: 1.0, alpha: 0.95)
    key.position = SCNVector3(2.2, 2.1, 2.3)
    scene.rootNode.addChildNode(key)

    let fill = SCNNode()
    fill.light = SCNLight()
    fill.light?.type = .omni
    fill.light?.color = UIColor(red: 0.24, green: 0.73, blue: 1.0, alpha: 0.42)
    fill.position = SCNVector3(-2.1, 1.6, 2.0)
    scene.rootNode.addChildNode(fill)

    let back = SCNNode()
    back.light = SCNLight()
    back.light?.type = .omni
    back.light?.color = UIColor(red: 0.95, green: 0.62, blue: 0.26, alpha: 0.30)
    back.position = SCNVector3(0.0, 1.5, -2.4)
    scene.rootNode.addChildNode(back)

    let ambient = SCNNode()
    ambient.light = SCNLight()
    ambient.light?.type = .ambient
    ambient.light?.color = UIColor(white: 0.13, alpha: 1.0)
    scene.rootNode.addChildNode(ambient)
  }

  private func buildCamera() {
    cameraNode.camera = SCNCamera()
    cameraNode.camera?.fieldOfView = 48
    cameraNode.camera?.zNear = 0.1
    cameraNode.camera?.zFar = 100
    scene.rootNode.addChildNode(cameraNode)

    let target = SCNLookAtConstraint(target: bodyRoot)
    target.isGimbalLockEnabled = true
    cameraNode.constraints = [target]
  }

  private func cameraPosition(for preset: String) -> SCNVector3 {
    switch preset {
    case "BACK":
      return SCNVector3(0, 1.0, -3.35)
    case "ORBIT":
      return SCNVector3(2.25, 1.0, 2.1)
    default:
      return SCNVector3(0, 1.0, 3.35)
    }
  }

  private func applyCameraPreset(animated: Bool) {
    let preset = currentCameraPreset()
    let position = cameraPosition(for: preset)

    SCNTransaction.begin()
    SCNTransaction.animationDuration = animated ? 0.22 : 0.0
    cameraNode.position = position
    if preset != "ORBIT" {
      if isOrbitGestureActive {
        isOrbitGestureActive = false
        emitInteractionState(false)
      }
      orbitYaw = 0
      bodyRoot.eulerAngles.y = 0
    }
    SCNTransaction.commit()
  }

  private func currentCameraPreset() -> String {
    let trimmed = (cameraPreset as String?)?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() ?? ""
    return trimmed.isEmpty ? "FRONT" : trimmed
  }

  private func baseMaterial() -> SCNMaterial {
    let material = SCNMaterial()
    material.diffuse.contents = UIColor(red: 0.08, green: 0.1, blue: 0.14, alpha: 1)
    material.roughness.contents = 0.95
    material.metalness.contents = 0.0
    material.lightingModel = .physicallyBased
    return material
  }

  private func regionMaterial() -> SCNMaterial {
    let material = SCNMaterial()
    material.diffuse.contents = UIColor(red: 0.20, green: 0.25, blue: 0.31, alpha: 1)
    material.emission.contents = UIColor.black
    material.roughness.contents = 0.50
    material.metalness.contents = 0.0
    material.lightingModel = .physicallyBased
    return material
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

  // If a bundled scene exists, this maps region nodes by key/id naming convention.
  // Expected region names: "<KEY>" or "region:<id>:<KEY>" or "region_<KEY>".
  private func loadBundledSceneIfAvailable() -> Bool {
    let candidates: [(String, String)] = [
      ("BodyMapModel", "scn"),
      ("BodyMap", "scn"),
      ("BodyMapModel", "usdz"),
      ("BodyMap", "usdz"),
      ("body_map", "scn"),
    ]

    for candidate in candidates {
      guard let url = Bundle.main.url(forResource: candidate.0, withExtension: candidate.1),
            let loadedScene = try? SCNScene(url: url, options: nil) else {
        continue
      }

      let container = SCNNode()
      container.name = "bodyMapSceneContainer"
      for child in loadedScene.rootNode.childNodes {
        container.addChildNode(child)
      }
      bodyRoot.addChildNode(container)

      seedRegionMaps()
      bindNodesFromLoadedScene(container)
      applyBaseMaterialToUnmappedNodes(in: container)

      if !regionNodes.isEmpty {
        return true
      }

      container.removeFromParentNode()
    }

    seedRegionMaps()
    return false
  }

  private func bindNodesFromLoadedScene(_ rootNode: SCNNode) {
    walkNodes(rootNode) { [weak self] node in
      guard let self else { return }
      guard node.geometry != nil else { return }
      guard let mapping = self.resolveRegionMapping(for: node) else { return }

      node.name = "region:\(mapping.id):\(mapping.key)"
      node.renderingOrder = 10
      node.geometry?.materials = [self.regionMaterial()]
      self.regionNodes[mapping.id] = node
      self.regionKeys[mapping.id] = mapping.key
      self.regionScores[mapping.id] = 0
    }
  }

  private func applyBaseMaterialToUnmappedNodes(in rootNode: SCNNode) {
    walkNodes(rootNode) { [weak self] node in
      guard let self else { return }
      guard node.geometry != nil else { return }
      guard !(node.name?.hasPrefix("region:") ?? false) else { return }
      node.geometry?.materials = [self.baseMaterial()]
    }
  }

  private func walkNodes(_ node: SCNNode, visit: (SCNNode) -> Void) {
    visit(node)
    for child in node.childNodes {
      walkNodes(child, visit: visit)
    }
  }

  private func resolveRegionMapping(for node: SCNNode) -> (id: Int, key: String)? {
    guard let rawName = node.name?.trimmingCharacters(in: .whitespacesAndNewlines), !rawName.isEmpty else { return nil }
    let upperName = rawName.uppercased()

    if upperName.hasPrefix("REGION:") {
      let parts = upperName.split(separator: ":")
      if parts.count >= 3, let id = Int(parts[1]), let key = regionKeyById[id] {
        return (id, key)
      }
    }

    if let id = regionIdByKey[upperName] {
      return (id, upperName)
    }

    if upperName.hasPrefix("REGION_") {
      let key = String(upperName.dropFirst("REGION_".count))
      if let id = regionIdByKey[key] {
        return (id, key)
      }
    }

    return nil
  }

  private func buildBaseSilhouette() {
    addBaseNode(SCNCapsule(capRadius: 0.24, height: 0.86), position: SCNVector3(0, 0.95, 0))
    addBaseNode(SCNSphere(radius: 0.14), position: SCNVector3(0, 1.48, 0))
    addBaseNode(SCNCapsule(capRadius: 0.09, height: 0.44), position: SCNVector3(-0.43, 0.92, 0))
    addBaseNode(SCNCapsule(capRadius: 0.09, height: 0.44), position: SCNVector3(0.43, 0.92, 0))
    addBaseNode(SCNCapsule(capRadius: 0.11, height: 0.74), position: SCNVector3(-0.18, 0.26, 0))
    addBaseNode(SCNCapsule(capRadius: 0.11, height: 0.74), position: SCNVector3(0.18, 0.26, 0))
  }

  private func buildRegions() {
    addRegionNode(id: 1, key: "CHEST_L", geometry: SCNSphere(radius: 0.12), position: SCNVector3(-0.16, 1.07, 0.16))
    addRegionNode(id: 2, key: "CHEST_R", geometry: SCNSphere(radius: 0.12), position: SCNVector3(0.16, 1.07, 0.16))

    addRegionNode(id: 3, key: "DELTS_FRONT_L", geometry: SCNSphere(radius: 0.08), position: SCNVector3(-0.33, 1.15, 0.15))
    addRegionNode(id: 4, key: "DELTS_FRONT_R", geometry: SCNSphere(radius: 0.08), position: SCNVector3(0.33, 1.15, 0.15))
    addRegionNode(id: 5, key: "DELTS_SIDE_L", geometry: SCNSphere(radius: 0.085), position: SCNVector3(-0.40, 1.13, 0.00))
    addRegionNode(id: 6, key: "DELTS_SIDE_R", geometry: SCNSphere(radius: 0.085), position: SCNVector3(0.40, 1.13, 0.00))
    addRegionNode(id: 7, key: "DELTS_REAR_L", geometry: SCNSphere(radius: 0.08), position: SCNVector3(-0.33, 1.15, -0.15))
    addRegionNode(id: 8, key: "DELTS_REAR_R", geometry: SCNSphere(radius: 0.08), position: SCNVector3(0.33, 1.15, -0.15))

    addRegionNode(id: 9, key: "BICEPS_L", geometry: SCNCapsule(capRadius: 0.055, height: 0.2), position: SCNVector3(-0.46, 0.98, 0.11))
    addRegionNode(id: 10, key: "BICEPS_R", geometry: SCNCapsule(capRadius: 0.055, height: 0.2), position: SCNVector3(0.46, 0.98, 0.11))
    addRegionNode(id: 11, key: "TRICEPS_L", geometry: SCNCapsule(capRadius: 0.055, height: 0.2), position: SCNVector3(-0.46, 0.98, -0.11))
    addRegionNode(id: 12, key: "TRICEPS_R", geometry: SCNCapsule(capRadius: 0.055, height: 0.2), position: SCNVector3(0.46, 0.98, -0.11))
    addRegionNode(id: 13, key: "FOREARMS_L", geometry: SCNCapsule(capRadius: 0.048, height: 0.22), position: SCNVector3(-0.52, 0.74, 0.0))
    addRegionNode(id: 14, key: "FOREARMS_R", geometry: SCNCapsule(capRadius: 0.048, height: 0.22), position: SCNVector3(0.52, 0.74, 0.0))

    addRegionNode(id: 15, key: "UPPER_BACK_L", geometry: SCNBox(width: 0.17, height: 0.17, length: 0.07, chamferRadius: 0.035), position: SCNVector3(-0.18, 1.09, -0.19))
    addRegionNode(id: 16, key: "UPPER_BACK_R", geometry: SCNBox(width: 0.17, height: 0.17, length: 0.07, chamferRadius: 0.035), position: SCNVector3(0.18, 1.09, -0.19))
    addRegionNode(id: 17, key: "LATS_L", geometry: SCNBox(width: 0.16, height: 0.20, length: 0.07, chamferRadius: 0.03), position: SCNVector3(-0.22, 0.90, -0.18))
    addRegionNode(id: 18, key: "LATS_R", geometry: SCNBox(width: 0.16, height: 0.20, length: 0.07, chamferRadius: 0.03), position: SCNVector3(0.22, 0.90, -0.18))
    addRegionNode(id: 19, key: "TRAPS_L", geometry: SCNSphere(radius: 0.07), position: SCNVector3(-0.10, 1.28, -0.12))
    addRegionNode(id: 20, key: "TRAPS_R", geometry: SCNSphere(radius: 0.07), position: SCNVector3(0.10, 1.28, -0.12))

    addRegionNode(id: 21, key: "ABS", geometry: SCNBox(width: 0.24, height: 0.33, length: 0.07, chamferRadius: 0.03), position: SCNVector3(0, 0.92, 0.18))
    addRegionNode(id: 22, key: "OBLIQUES_L", geometry: SCNBox(width: 0.09, height: 0.25, length: 0.07, chamferRadius: 0.02), position: SCNVector3(-0.18, 0.92, 0.16))
    addRegionNode(id: 23, key: "OBLIQUES_R", geometry: SCNBox(width: 0.09, height: 0.25, length: 0.07, chamferRadius: 0.02), position: SCNVector3(0.18, 0.92, 0.16))
    addRegionNode(id: 24, key: "LOWER_BACK", geometry: SCNBox(width: 0.24, height: 0.18, length: 0.07, chamferRadius: 0.025), position: SCNVector3(0, 0.76, -0.18))

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

    addRegionNode(id: 39, key: "NECK", geometry: SCNCapsule(capRadius: 0.06, height: 0.15), position: SCNVector3(0, 1.33, 0.0))
  }

  @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
    let point = gesture.location(in: scnView)
    let hits = scnView.hitTest(point, options: [SCNHitTestOption.searchMode: SCNHitTestSearchMode.all.rawValue])

    guard let mappedNode = hits.compactMap({ resolveRegionNode($0.node) }).first,
          let name = mappedNode.name else {
      selectedRegionId = 0
      applySelection(animated: true)
      onRegionPress?(["regionId": 0, "regionKey": "", "score": 0])
      return
    }

    let parts = name.split(separator: ":")
    guard parts.count >= 3, let regionId = Int(parts[1]) else { return }
    let key = String(parts[2])
    let score = regionScores[regionId] ?? 0

    selectedRegionId = NSNumber(value: regionId)
    applySelection(animated: true)
    onRegionPress?([
      "regionId": regionId,
      "regionKey": key,
      "score": score,
    ])
  }

  @objc private func handlePan(_ gesture: UIPanGestureRecognizer) {
    guard currentCameraPreset() == "ORBIT" else { return }

    switch gesture.state {
    case .began:
      isOrbitGestureActive = true
      emitInteractionState(true)
    case .changed:
      let translation = gesture.translation(in: scnView)
      let deltaYaw = Float(translation.x) * 0.0052
      orbitYaw += deltaYaw
      bodyRoot.eulerAngles.y = orbitYaw
      gesture.setTranslation(.zero, in: scnView)
    case .ended, .cancelled, .failed:
      if isOrbitGestureActive {
        isOrbitGestureActive = false
        emitInteractionState(false)
      }
    default:
      break
    }
  }

  private func emitInteractionState(_ interacting: Bool) {
    onInteractionStateChange?(["interacting": interacting])
  }

  private func resolveRegionNode(_ node: SCNNode?) -> SCNNode? {
    var cursor = node
    while let current = cursor {
      if current.name?.hasPrefix("region:") == true {
        return current
      }
      cursor = current.parent
    }
    return nil
  }

  private func applySnapshotFromJson() {
    guard let json = snapshotJson as String?,
          let data = json.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data, options: []),
          let root = object as? [String: Any] else {
      return
    }

    let modeFromProp = (overlayMode as String?)?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    let modeFromSnapshot = String(describing: root["overlayMode"] ?? "STIMULUS").uppercased()
    if modeFromProp?.isEmpty == false {
      cachedOverlayMode = modeFromProp!
    } else {
      cachedOverlayMode = modeFromSnapshot
    }

    guard let regions = root["regions"] as? [[String: Any]] else { return }

    var nextScores: [Int: Double] = [:]
    for region in regionDefinitions {
      nextScores[region.id] = 0
    }

    for row in regions {
      guard let id = row["id"] as? Int, id > 0, id < 256 else { continue }
      let key = (row["key"] as? String) ?? (regionKeys[id] ?? "")
      if !key.isEmpty {
        regionKeys[id] = key
      }

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
    CATransaction.begin()
    CATransaction.setAnimationDuration(0.24)

    for (id, node) in regionNodes {
      let score = regionScores[id] ?? 0
      let normalized = max(0.0, min(1.0, score / 100.0))
      let color = colorForIntensity(normalized)
      if let material = node.geometry?.firstMaterial {
        material.diffuse.contents = color.withAlphaComponent(0.94)
        material.emission.contents = color.withAlphaComponent(0.16 + CGFloat(normalized) * 0.22)
      }
    }

    CATransaction.commit()
  }

  private func applySelection(animated: Bool) {
    let selectedId = selectedRegionId?.intValue ?? 0

    CATransaction.begin()
    CATransaction.setDisableActions(!animated)
    CATransaction.setAnimationDuration(animated ? 0.18 : 0.0)

    for (id, node) in regionNodes {
      let isSelected = id == selectedId && selectedId > 0
      let baseScore = regionScores[id] ?? 0
      let normalized = max(0.0, min(1.0, baseScore / 100.0))
      let baseColor = colorForIntensity(normalized)

      node.scale = isSelected ? SCNVector3(1.04, 1.04, 1.04) : SCNVector3(1, 1, 1)
      if let material = node.geometry?.firstMaterial {
        if isSelected {
          material.diffuse.contents = blend(baseColor, UIColor.white, t: 0.08)
          material.emission.contents = baseColor.withAlphaComponent(0.52)
        } else {
          material.diffuse.contents = baseColor.withAlphaComponent(0.94)
          material.emission.contents = baseColor.withAlphaComponent(0.16 + CGFloat(normalized) * 0.22)
        }
      }
    }

    CATransaction.commit()
  }

  private func colorForIntensity(_ tIn: CGFloat) -> UIColor {
    let t = max(0, min(1, tIn))
    let low = UIColor(hex: "#4A5568")
    let trained = UIColor(hex: "#22D3EE")
    let high = UIColor(hex: "#F59E0B")
    let redline = UIColor(hex: "#EF4444")

    if t < 0.33 {
      return blend(low, trained, t: t / 0.33)
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
      (r, g, b) = (0x4A, 0x55, 0x68)
    }
    self.init(red: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: 1)
  }
}
