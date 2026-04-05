import Foundation
import UIKit
import SceneKit
import CoreMotion
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
  private var orbitRoll: Float = 0
  private var cameraDistance: Float = 3.35
  private var minCameraDistance: Float = 2.1
  private var maxCameraDistance: Float = 5.4
  private var frontBackOrthographicScale: Double = 1.15
  private var frontBackCameraDistance: Float = 3.1
  private var lookAtConstraint: SCNLookAtConstraint?
  private var activeGestureCount = 0
  private var rendererMode: String = "unknown"
  private let motionManager = CMMotionManager()
  private var isGyroActive = false
  private var gyroReferenceAttitude: CMAttitude?
  private var gyroBaseYaw: Float = 0
  private var gyroBasePitch: Float = 0
  private var gyroBaseRoll: Float = 0

  private let defaultOrbitYaw: Float = 0.72
  private let defaultOrbitPitch: Float = 0.10

  override init(frame: CGRect) {
    super.init(frame: frame)
    commonInit()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    commonInit()
  }

  deinit {
    stopGyroscope(resetReference: true)
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
    lookAtConstraint = target
    cameraNode.constraints = [target]
  }

  private func moveCamera(to position: SCNVector3, animated: Bool) {
    SCNTransaction.begin()
    SCNTransaction.animationDuration = animated ? 0.22 : 0.0
    cameraNode.position = position
    if (cameraNode.constraints?.isEmpty ?? true),
       let orientation = orbitCameraOrientation(for: position, focus: focusWorldPosition(), roll: orbitRoll) {
      cameraNode.simdOrientation = orientation
    }
    SCNTransaction.commit()
  }

  private func focusWorldPosition() -> SCNVector3 {
    focusNode.presentation.worldPosition
  }

  private func orbitCameraPosition(around focus: SCNVector3) -> SCNVector3 {
    let clampedPitch = clamp(orbitPitch, min: -0.55, max: 0.35)
    let cosPitch = cos(clampedPitch)
    return SCNVector3(
      focus.x + cameraDistance * sin(orbitYaw) * cosPitch,
      focus.y + cameraDistance * sin(clampedPitch),
      focus.z + cameraDistance * cos(orbitYaw) * cosPitch
    )
  }

  private func orbitCameraOrientation(for position: SCNVector3, focus: SCNVector3, roll: Float) -> simd_quatf? {
    let from = SIMD3<Float>(position.x, position.y, position.z)
    let to = SIMD3<Float>(focus.x, focus.y, focus.z)
    var forward = to - from
    let forwardLength = simd_length(forward)
    guard forwardLength.isFinite, forwardLength > 0.0001 else { return nil }
    forward /= forwardLength

    var worldUp = SIMD3<Float>(0, 1, 0)
    if abs(simd_dot(forward, worldUp)) > 0.98 {
      worldUp = SIMD3<Float>(0, 0, 1)
    }

    var right = simd_cross(worldUp, forward)
    let rightLength = simd_length(right)
    guard rightLength.isFinite, rightLength > 0.0001 else { return nil }
    right /= rightLength

    var up = simd_normalize(simd_cross(forward, right))
    if !up.x.isFinite || !up.y.isFinite || !up.z.isFinite {
      return nil
    }

    if abs(roll) > 0.0001 {
      let c = cos(roll)
      let s = sin(roll)
      let rolledRight = right * c - up * s
      let rolledUp = right * s + up * c
      right = simd_normalize(rolledRight)
      up = simd_normalize(rolledUp)
    }

    let worldZ = -forward
    let rotation = simd_float3x3(columns: (right, up, worldZ))
    return simd_quatf(rotation)
  }

  private func updateOrbitCamera(animated: Bool) {
    moveCamera(to: orbitCameraPosition(around: focusWorldPosition()), animated: animated)
  }

  private func applyCameraPreset(animated: Bool) {
    let preset = currentCameraPreset()
    let focus = focusWorldPosition()
    guard let camera = cameraNode.camera else { return }
    if preset != "ORBIT" {
      stopGyroscope(resetReference: false)
      if activeGestureCount > 0 {
        activeGestureCount = 0
        emitInteractionState(false)
      }
      if let lookAtConstraint {
        cameraNode.constraints = [lookAtConstraint]
      } else {
        cameraNode.constraints = nil
      }
      camera.usesOrthographicProjection = true
      camera.orthographicScale = frontBackOrthographicScale
      orbitRoll = 0
      let z = preset == "BACK" ? (focus.z - frontBackCameraDistance) : (focus.z + frontBackCameraDistance)
      moveCamera(to: SCNVector3(focus.x, focus.y, z), animated: animated)
      return
    }
    cameraNode.constraints = nil
    camera.usesOrthographicProjection = false
    camera.fieldOfView = 36
    startGyroscopeIfNeeded()
    updateOrbitCamera(animated: animated)
  }

  private func startGyroscopeIfNeeded() {
    guard motionManager.isDeviceMotionAvailable else {
      isGyroActive = false
      return
    }
    if motionManager.isDeviceMotionActive {
      isGyroActive = true
      return
    }

    motionManager.deviceMotionUpdateInterval = 1.0 / 60.0
    gyroBaseYaw = orbitYaw
    gyroBasePitch = orbitPitch
    gyroBaseRoll = orbitRoll
    gyroReferenceAttitude = nil

    motionManager.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: OperationQueue.main) { [weak self] motion, error in
      guard let self else { return }
      guard self.currentCameraPreset() == "ORBIT" else { return }
      guard error == nil, let motion else { return }
      self.applyGyroMotion(motion)
    }
    isGyroActive = motionManager.isDeviceMotionActive
  }

  private func stopGyroscope(resetReference: Bool) {
    if motionManager.isDeviceMotionActive {
      motionManager.stopDeviceMotionUpdates()
    }
    isGyroActive = false
    if resetReference {
      gyroReferenceAttitude = nil
    }
  }

  private func recenterGyroscope() {
    guard let currentAttitude = motionManager.deviceMotion?.attitude.copy() as? CMAttitude else { return }
    gyroReferenceAttitude = currentAttitude
    gyroBaseYaw = orbitYaw
    gyroBasePitch = orbitPitch
    gyroBaseRoll = orbitRoll
  }

  private func applyGyroMotion(_ motion: CMDeviceMotion) {
    if gyroReferenceAttitude == nil {
      gyroReferenceAttitude = motion.attitude.copy() as? CMAttitude
      gyroBaseYaw = orbitYaw
      gyroBasePitch = orbitPitch
      gyroBaseRoll = orbitRoll
      return
    }

    guard let referenceAttitude = gyroReferenceAttitude,
          let relativeAttitude = motion.attitude.copy() as? CMAttitude else {
      return
    }

    relativeAttitude.multiply(byInverseOf: referenceAttitude)

    let yawDelta = clamp(-Float(relativeAttitude.yaw), min: -.pi, max: .pi)
    let pitchDelta = clamp(Float(relativeAttitude.pitch), min: -0.8, max: 0.8)
    let rollDelta = clamp(-Float(relativeAttitude.roll), min: -0.9, max: 0.9)

    orbitYaw = gyroBaseYaw + yawDelta
    orbitPitch = clamp(gyroBasePitch + pitchDelta, min: -0.55, max: 0.35)
    orbitRoll = clamp(gyroBaseRoll + (rollDelta * 0.65), min: -0.7, max: 0.7)
    updateOrbitCamera(animated: false)
  }

  private func clamp(_ value: Float, min minValue: Float, max maxValue: Float) -> Float {
    Swift.max(minValue, Swift.min(maxValue, value))
  }

  private func localGeometryBounds(of root: SCNNode) -> (min: SCNVector3, max: SCNVector3)? {
    var found = false
    var minV = SCNVector3(Float.greatestFiniteMagnitude, Float.greatestFiniteMagnitude, Float.greatestFiniteMagnitude)
    var maxV = SCNVector3(-Float.greatestFiniteMagnitude, -Float.greatestFiniteMagnitude, -Float.greatestFiniteMagnitude)

    func absorb(_ point: SCNVector3) {
      minV.x = min(minV.x, point.x)
      minV.y = min(minV.y, point.y)
      minV.z = min(minV.z, point.z)
      maxV.x = max(maxV.x, point.x)
      maxV.y = max(maxV.y, point.y)
      maxV.z = max(maxV.z, point.z)
    }

    walkNodes(root) { node in
      guard node.geometry != nil else { return }
      let (bmin, bmax) = node.boundingBox
      let corners = [
        SCNVector3(bmin.x, bmin.y, bmin.z), SCNVector3(bmin.x, bmin.y, bmax.z),
        SCNVector3(bmin.x, bmax.y, bmin.z), SCNVector3(bmin.x, bmax.y, bmax.z),
        SCNVector3(bmax.x, bmin.y, bmin.z), SCNVector3(bmax.x, bmin.y, bmax.z),
        SCNVector3(bmax.x, bmax.y, bmin.z), SCNVector3(bmax.x, bmax.y, bmax.z),
      ]
      for corner in corners {
        absorb(root.convertPosition(corner, from: node))
        found = true
      }
    }

    return found ? (minV, maxV) : nil
  }

  private func normalizeModelOrientation(_ modelRoot: SCNNode) {
    let base = modelRoot.eulerAngles
    let uprightCandidates: [SCNVector3] = [
      base,
      SCNVector3(base.x + (.pi / 2), base.y, base.z),
      SCNVector3(base.x - (.pi / 2), base.y, base.z),
      SCNVector3(base.x, base.y, base.z + (.pi / 2)),
      SCNVector3(base.x, base.y, base.z - (.pi / 2)),
    ]

    var bestEuler = base
    var bestScore: Float = -.greatestFiniteMagnitude

    for candidate in uprightCandidates {
      modelRoot.eulerAngles = candidate
      guard let bounds = localGeometryBounds(of: modelRoot) else { continue }
      let size = SCNVector3(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z)
      let dominantSpan = max(size.x, size.z)
      guard dominantSpan > 0.0001 else { continue }
      let heightDominance = size.y / dominantSpan
      let score = size.y + (heightDominance * 10.0)
      if score > bestScore {
        bestScore = score
        bestEuler = candidate
      }
    }

    modelRoot.eulerAngles = bestEuler

    guard let upright = localGeometryBounds(of: modelRoot) else { return }
    let uprightSize = SCNVector3(upright.max.x - upright.min.x, upright.max.y - upright.min.y, upright.max.z - upright.min.z)
    if uprightSize.z > uprightSize.x {
      modelRoot.eulerAngles.y += .pi / 2
    }
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
      material.readsFromDepthBuffer = true
      material.writesToDepthBuffer = false
      material.cullMode = .back
      material.isDoubleSided = false
      material.blendMode = .alpha
      material.transparencyMode = .dualLayer
    }
  }

  private func fitLoadedModel(_ modelRoot: SCNNode) {
    normalizeModelOrientation(modelRoot)
    guard let rawBounds = localGeometryBounds(of: modelRoot) else {
      applyCameraPreset(animated: false)
      return
    }

    let width = rawBounds.max.x - rawBounds.min.x
    let height = rawBounds.max.y - rawBounds.min.y
    let depth = rawBounds.max.z - rawBounds.min.z

    guard width > 0.0001, height > 0.0001, depth > 0.0001 else {
      applyCameraPreset(animated: false)
      return
    }

    let center = SCNVector3(
      (rawBounds.min.x + rawBounds.max.x) * 0.5,
      (rawBounds.min.y + rawBounds.max.y) * 0.5,
      (rawBounds.min.z + rawBounds.max.z) * 0.5
    )

    // Use translation instead of pivot so the focus point and bounds stay stable.
    modelRoot.pivot = SCNMatrix4Identity
    modelRoot.position = SCNVector3(-center.x, -center.y, -center.z)

    guard let centeredBounds = localGeometryBounds(of: modelRoot) else {
      applyCameraPreset(animated: false)
      return
    }

    let centeredWidth = centeredBounds.max.x - centeredBounds.min.x
    let centeredHeight = centeredBounds.max.y - centeredBounds.min.y
    let centeredDepth = centeredBounds.max.z - centeredBounds.min.z

    let radius = max(centeredWidth, max(centeredHeight, centeredDepth)) * 0.5
    cameraDistance = max(2.35, radius * 2.45)
    minCameraDistance = max(1.8, radius * 1.8)
    maxCameraDistance = max(4.2, radius * 5.0)
    frontBackCameraDistance = max(2.4, centeredDepth * 3.0 + 0.8)
    // orthographicScale in SceneKit is half-height. Fit against both torso height and shoulder width.
    let halfHeightFit = centeredHeight * 0.58
    let halfWidthFit = centeredWidth * 0.72
    frontBackOrthographicScale = Double(max(0.82, max(halfHeightFit, halfWidthFit)))
    focusNode.position = SCNVector3(0, max(0.06, centeredHeight * 0.08), 0)
    orbitYaw = defaultOrbitYaw
    orbitPitch = defaultOrbitPitch
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
      if isGyroActive {
        recenterGyroscope()
      }
    case .changed:
      let translation = gesture.translation(in: scnView)
      if isGyroActive {
        gyroBaseYaw += Float(translation.x) * 0.0048
        gyroBasePitch = clamp(gyroBasePitch - Float(translation.y) * 0.0032, min: -0.55, max: 0.35)
        orbitYaw = gyroBaseYaw
        orbitPitch = gyroBasePitch
      } else {
        orbitYaw += Float(translation.x) * 0.0048
        orbitPitch = clamp(orbitPitch - Float(translation.y) * 0.0032, min: -0.55, max: 0.35)
      }
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
      material.transparencyMode = .dualLayer
      material.readsFromDepthBuffer = true
      material.writesToDepthBuffer = false
      material.cullMode = .back
      material.isDoubleSided = false
      material.blendMode = .alpha
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
