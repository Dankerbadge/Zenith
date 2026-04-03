import Foundation

enum ZenithWorkoutKind: String, Codable {
  case run
  case lift
}

enum ZenithRunEnvironment: String, Codable, Hashable {
  case outdoor
  case treadmill
}

enum ZenithWatchSessionState: String, Codable {
  case idle
  case recording
  case paused
  case endingConfirm
  case ended
}

struct ZenithWatchSessionSnapshot: Codable, Hashable {
  var kind: ZenithWorkoutKind
  var sessionId: String
  var state: ZenithWatchSessionState

  // Run context (optional for backward compatibility with older snapshots).
  var runEnvironment: ZenithRunEnvironment?

  var startedAtUtc: String
  var endedAtUtc: String?

  var elapsedTimeSec: Int
  var movingTimeSec: Int
  var pausedTotalSec: Int

  // Run
  // Raw (uncalibrated) distance from the system workout engine.
  var rawDistanceMiles: Double?
  // Treadmill calibration factor used for this session (frozen at start).
  var treadmillCalibrationFactorUsed: Double?
  var totalDistanceMiles: Double
  var paceMinPerMile: Double?

  // Lift
  var totalCalories: Int
  var setCount: Int
  var intensityBand: String

  var seq: Int
  var lastUpdatedAtUtc: String
}
