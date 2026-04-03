//
//  ZenithRunLiveActivity.swift
//  ZenithWidgets
//
//  Live Activity UI + controls for an active watch-authoritative run.
//  This target must remain local-first: it sends watch commands directly and never depends on Supabase.
//

import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// Keep this structure aligned with the app-side ZenithRunAttributes used to request/update the Live Activity.
// NOTE: We intentionally keep this "UI-only" and never treat it as workout truth.
struct ZenithRunAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var state: String
    var elapsedTimeSec: Int
    var movingTimeSec: Int
    var pausedTotalSec: Int
    var totalDistanceMiles: Double
    var paceMinPerMile: Double?
    var seq: Int
    var lastUpdatedAtWatch: String
    var uiEndArmedUntilEpochMs: Int64?
  }

  var sessionId: String
}

private func fmtDuration(_ totalSec: Int) -> String {
  let sec = max(0, totalSec)
  let h = sec / 3600
  let m = (sec % 3600) / 60
  let s = sec % 60
  if h > 0 { return String(format: "%02d:%02d:%02d", h, m, s) }
  return String(format: "%02d:%02d", m, s)
}

private func fmtDistanceMiles(_ miles: Double) -> String {
  return String(format: "%.2f mi", max(0, miles))
}

private func fmtPace(_ paceMinPerMile: Double?) -> String {
  guard let pace = paceMinPerMile, pace.isFinite, pace > 0 else { return "—" }
  let totalSec = Int(round(pace * 60.0))
  let m = totalSec / 60
  let s = totalSec % 60
  return String(format: "%d:%02d /mi", m, s)
}

private func isArmed(_ armedUntil: Int64?) -> Bool {
  guard let until = armedUntil, until > 0 else { return false }
  return Int64(Date().timeIntervalSince1970 * 1000) <= until
}

private func armUntilMs() -> Int64 {
  return Int64(Date().timeIntervalSince1970 * 1000) + 2500
}

struct ZenithRunLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: ZenithRunAttributes.self) { context in
      // Lock screen / banner
      VStack(alignment: .leading, spacing: 8) {
        HStack(alignment: .firstTextBaseline) {
          Text("Zenith Run")
            .font(.headline)
          Spacer()
          Text(String(context.state.state.capitalized))
            .font(.caption)
            .foregroundStyle(.secondary)
        }

        HStack(alignment: .firstTextBaseline) {
          VStack(alignment: .leading, spacing: 2) {
            Text("Time")
              .font(.caption2)
              .foregroundStyle(.secondary)
            Text(fmtDuration(context.state.elapsedTimeSec))
              .font(.title3)
              .monospacedDigit()
          }
          Spacer()
          VStack(alignment: .trailing, spacing: 2) {
            Text("Distance")
              .font(.caption2)
              .foregroundStyle(.secondary)
            Text(fmtDistanceMiles(context.state.totalDistanceMiles))
              .font(.title3)
              .monospacedDigit()
          }
        }

        HStack {
          Text("Pace \(fmtPace(context.state.paceMinPerMile))")
            .font(.caption)
            .foregroundStyle(.secondary)
          Spacer()
        }

        // Controls
        HStack(spacing: 10) {
          if context.state.state == "paused" {
            Button(intent: ZenithRunResumeIntent(sessionId: context.attributes.sessionId)) {
              Text("Resume")
            }
            .buttonStyle(.bordered)
          } else {
            Button(intent: ZenithRunPauseIntent(sessionId: context.attributes.sessionId)) {
              Text("Pause")
            }
            .buttonStyle(.bordered)
          }

          if isArmed(context.state.uiEndArmedUntilEpochMs) {
            Button(intent: ZenithRunConfirmEndIntent(sessionId: context.attributes.sessionId)) {
              Text("Tap again")
            }
            .buttonStyle(.borderedProminent)
          } else {
            Button(
              intent: ZenithRunArmEndIntent(
                sessionId: context.attributes.sessionId,
                state: context.state.state,
                elapsedTimeSec: context.state.elapsedTimeSec,
                movingTimeSec: context.state.movingTimeSec,
                pausedTotalSec: context.state.pausedTotalSec,
                totalDistanceMiles: context.state.totalDistanceMiles,
                paceMinPerMile: context.state.paceMinPerMile,
                seq: context.state.seq,
                lastUpdatedAtWatch: context.state.lastUpdatedAtWatch
              )
            ) {
              Text("End")
            }
            .buttonStyle(.bordered)
          }
        }
      }
      .activityBackgroundTint(Color.black.opacity(0.35))
      .activitySystemActionForegroundColor(Color.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text("ZENITH")
            .font(.caption2)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(fmtDuration(context.state.elapsedTimeSec))
            .monospacedDigit()
            .font(.caption)
        }
        DynamicIslandExpandedRegion(.bottom) {
          HStack {
            Text(fmtDistanceMiles(context.state.totalDistanceMiles))
              .monospacedDigit()
            Spacer()
            Text(fmtPace(context.state.paceMinPerMile))
              .monospacedDigit()
          }
          .font(.caption)
        }
      } compactLeading: {
        Text("Z")
      } compactTrailing: {
        Text(fmtDuration(context.state.elapsedTimeSec))
          .monospacedDigit()
          .font(.caption2)
      } minimal: {
        Text("Z")
      }
      .widgetURL(URL(string: "zenith://live-run"))
      .keylineTint(Color.cyan)
    }
  }
}
