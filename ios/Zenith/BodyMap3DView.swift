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

  @objc var allowPrimitiveFallback: NSNumber?

  @objc var selectedRegionId: NSNumber? {
    didSet { applySelection(animated: true) }
  }

  @objc var onRegionPress: RCTBubblingEventBlock?
  @objc var onInteractionStateChange: RCTBubblingEventBlock?
  @objc var onRendererStateChange: RCTBubblingEventBlock? {
    didSet { emitRendererState() }
  }

  private let scnView = SCNView(frame: .zero)
  private let scene = SCNScene()
  private let bodyRoot = SCNNode()
  private let focusNode = SCNNode()
  private let cameraNode = SCNNode()

  private var regionNodes: [Int: SCNNode] = [:]
  private var regionKeys: [Int: String] = [:]
  private var regionScores: [Int: Double] = [:]
  private var cachedOverlayMode: String = "STIMULUS"
  private var orbitYaw: Float = 0
  private var orbitPitch: Float = -0.08
  private var cameraDistance: Float = 3.35
  private var minCameraDistance: Float = 2.1
  private var maxCameraDistance: Float = 5.4
  private var frontBackOrthographicScale: Double = 2.4
  private var frontBackVerticalOffset: Float = 0.05
  private var activeGestureCount = 0
  private var rendererMode: String = "unknown"

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
    focusNode.name = "cameraFocus"
    bodyRoot.addChildNode(focusNode)
    seedRegionMaps()
    buildLighting()
    buildCamera()

    if loadBundledSceneIfAvailable() {
      setRendererMode("asset")
    } else if shouldUsePrimitiveFallback() {
      buildBaseSilhouette()
      buildRegions()
      fitLoadedModel(bodyRoot)
      setRendererMode("primitive")
    } else {
      setRendererMode("missing_asset")
    }

    let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    scnView.addGestureRecognizer(tap)
    let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
    pan.minimumNumberOfTouches = 1
    pan.maximumNumberOfTouches = 1
    pan.cancelsTouchesInView = true
    scnView.addGestureRecognizer(pan)
    let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
    pinch.cancelsTouchesInView = true
    scnView.addGestureRecognizer(pinch)

    applyCameraPreset(animated: false)
    applySnapshotFromJson()
    emitRendererState()
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
    key.light?.color = UIColor(white: 0.98, alpha: 1.0)
    key.light?.intensity = 860
    key.position = SCNVector3(2.35, 2.25, 2.45)
    scene.rootNode.addChildNode(key)

    let fill = SCNNode()
    fill.light = SCNLight()
    fill.light?.type = .omni
    fill.light?.color = UIColor(red: 0.94, green: 0.96, blue: 0.99, alpha: 1.0)
    fill.light?.intensity = 290
    fill.position = SCNVector3(-2.15, 1.65, 1.9)
    scene.rootNode.addChildNode(fill)

    let rim = SCNNode()
    rim.light = SCNLight()
    rim.light?.type = .omni
    rim.light?.color = UIColor(red: 0.86, green: 0.90, blue: 0.97, alpha: 1.0)
    rim.light?.intensity = 120
    rim.position = SCNVector3(0.65, 1.55, -2.35)
    scene.rootNode.addChildNode(rim)

    let ambient = SCNNode()
    ambient.light = SCNLight()
    ambient.light?.type = .ambient
    ambient.light?.color = UIColor(white: 0.16, alpha: 1.0)
    ambient.light?.intensity = 100
    scene.rootNode.addChildNode(ambient)
  }

  private func buildCamera() {
    cameraNode.camera = SCNCamera()
    cameraNode.camera?.fieldOfView = 36
    cameraNode.camera?.zNear = 0.05
    cameraNode.camera?.zFar = 100
    cameraNode.camera?.automaticallyAdjustsZRange = true
    cameraNode.camera?.usesOrthographicProjection = false
    scene.rootNode.addChildNode(cameraNode)

    let target = SCNLookAtConstraint(target: focusNode)
    target.isGimbalLockEnabled = true
    cameraNode.constraints = [target]
  }

  private func moveCamera(to position: SCNVector3, animated: Bool) {
    SCNTransaction.begin()
    SCNTransaction.animationDuration = animated ? 0.22 : 0.0
    cameraNode.position = position
    SCNTransaction.commit()
  }

  private func focusWorldPosition() -> SCNVector3 {
    focusNode.presentation.worldPosition
  }

  private func orbitCameraPosition(around focus: SCNVector3) -> SCNVector3 {
    let clampedPitch = max(-0.45, min(0.25, orbitPitch))
    let cosPitch = cos(clampedPitch)
    return SCNVector3(
      focus.x + cameraDistance * sin(orbitYaw) * cosPitch,
      focus.y + cameraDistance * sin(clampedPitch),
      focus.z + cameraDistance * cos(orbitYaw) * cosPitch
    )
  }

  private func updateOrbitCamera(animated: Bool) {
    moveCamera(to: orbitCameraPosition(around: focusWorldPosition()), animated: animated)
  }

  private func applyCameraPreset(animated: Bool) {
    let preset = currentCameraPreset()
    let focus = focusWorldPosition()
    guard let camera = cameraNode.camera else { return }
    if preset != "ORBIT" {
      if activeGestureCount > 0 {
        activeGestureCount = 0
        emitInteractionState(false)
      }
      camera.usesOrthographicProjection = true
      camera.orthographicScale = frontBackOrthographicScale
      let y = focus.y + frontBackVerticalOffset
      let z = preset == "BACK" ? (focus.z - cameraDistance) : (focus.z + cameraDistance)
      moveCamera(to: SCNVector3(focus.x, y, z), animated: animated)
      return
    }
    camera.usesOrthographicProjection = false
    camera.fieldOfView = 36
    updateOrbitCamera(animated: animated)
  }

  private func shouldUsePrimitiveFallback() -> Bool {
    allowPrimitiveFallback?.boolValue ?? false
  }

  private func setRendererMode(_ mode: String) {
    rendererMode = mode
    emitRendererState()
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

      let container = loadedScene.rootNode.clone()
      container.name = "bodyMapSceneContainer"
      bodyRoot.addChildNode(container)

      seedRegionMaps()
      bindNodesFromLoadedScene(container)

      if !regionNodes.isEmpty {
        fitLoadedModel(container)
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
      self.prepareRegionMaterials(node)
      self.regionNodes[mapping.id] = node
      self.regionKeys[mapping.id] = mapping.key
      self.regionScores[mapping.id] = 0
    }
  }

  private func prepareRegionMaterials(_ node: SCNNode) {
    guard let geometry = node.geometry else { return }
    if geometry.materials.isEmpty {
      geometry.materials = [regionMaterial()]
    }
    for material in geometry.materials {
      material.lightingModel = .physicallyBased
      material.multiply.contents = UIColor.white
      material.emission.contents = UIColor.black
    }
  }

  private func fitLoadedModel(_ modelRoot: SCNNode) {
    let (minB, maxB) = modelRoot.boundingBox
    let width = maxB.x - minB.x
    let height = maxB.y - minB.y
    let depth = maxB.z - minB.z

    guard width > 0.0001, height > 0.0001, depth > 0.0001 else {
      applyCameraPreset(animated: false)
      return
    }

    let center = SCNVector3(
      (minB.x + maxB.x) * 0.5,
      (minB.y + maxB.y) * 0.5,
      (minB.z + maxB.z) * 0.5
    )
    modelRoot.pivot = SCNMatrix4MakeTranslation(center.x, center.y, center.z)

    let radius = max(width, max(height, depth)) * 0.5
    cameraDistance = max(2.95, radius * 3.35)
    minCameraDistance = max(1.8, radius * 1.8)
    maxCameraDistance = max(4.2, radius * 5.0)
    frontBackOrthographicScale = Double(max(2.0, height * 1.16))
    frontBackVerticalOffset = max(0.05, height * 0.04)
    focusNode.position = SCNVector3(0, max(0.03, height * 0.02), 0)
    orbitYaw = 0
    orbitPitch = -0.08
    cameraNode.camera?.fieldOfView = 36
    cameraNode.camera?.automaticallyAdjustsZRange = true
    applyCameraPreset(animated: false)
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
      beginInteraction()
    case .changed:
      let translation = gesture.translation(in: scnView)
      orbitYaw += Float(translation.x) * 0.0048
      orbitPitch = max(-0.45, min(0.25, orbitPitch - Float(translation.y) * 0.0032))
      updateOrbitCamera(animated: false)
      gesture.setTranslation(.zero, in: scnView)
    case .ended, .cancelled, .failed:
      endInteraction()
    default:
      break
    }
  }

  @objc private func handlePinch(_ gesture: UIPinchGestureRecognizer) {
    guard currentCameraPreset() == "ORBIT" else { return }

    switch gesture.state {
    case .began:
      beginInteraction()
    case .changed:
      cameraDistance = max(minCameraDistance, min(maxCameraDistance, cameraDistance / Float(gesture.scale)))
      updateOrbitCamera(animated: false)
      gesture.scale = 1.0
    case .ended, .cancelled, .failed:
      endInteraction()
    default:
      break
    }
  }

  private func beginInteraction() {
    activeGestureCount += 1
    if activeGestureCount == 1 {
      emitInteractionState(true)
    }
  }

  private func endInteraction() {
    guard activeGestureCount > 0 else { return }
    activeGestureCount -= 1
    if activeGestureCount == 0 {
      emitInteractionState(false)
    }
  }

  private func emitInteractionState(_ interacting: Bool) {
    onInteractionStateChange?(["interacting": interacting])
  }

  private func emitRendererState() {
    onRendererStateChange?(["mode": rendererMode])
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
      applyRegionTint(to: node, color: color, normalized: normalized, selected: false)
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

      // Keep selection purely visual; scaling shells makes anatomy read like armor.
      node.scale = SCNVector3(1, 1, 1)
      applyRegionTint(to: node, color: baseColor, normalized: normalized, selected: isSelected)
    }

    CATransaction.commit()
  }

  private func applyRegionTint(to node: SCNNode, color: UIColor, normalized: CGFloat, selected: Bool) {
    guard let geometry = node.geometry else { return }
    if geometry.materials.isEmpty {
      geometry.materials = [regionMaterial()]
    }

    let clamped = max(0, min(1, normalized))
    let neutralPlate = UIColor(hex: "#1A222D")
    let highlightColor = selected ? blend(color, UIColor.white, t: 0.10) : color
    let tintStrength = selected
      ? (0.22 + clamped * 0.70)
      : (0.06 + clamped * 0.74)
    let tintColor = blend(neutralPlate, highlightColor, t: tintStrength)
    let shellAlpha = selected
      ? (0.18 + clamped * 0.70)
      : (0.06 + clamped * 0.68)
    let emissionAlpha = selected
      ? (0.03 + clamped * 0.08)
      : (0.00 + clamped * 0.02)

    for material in geometry.materials {
      material.lightingModel = .physicallyBased
      material.multiply.contents = tintColor
      material.transparency = shellAlpha
      material.transparencyMode = .aOne
      material.emission.contents = highlightColor.withAlphaComponent(emissionAlpha)
      if rendererMode == "primitive" {
        material.diffuse.contents = highlightColor.withAlphaComponent(shellAlpha)
      }
    }
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
