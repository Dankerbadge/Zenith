using Toybox.Activity;
using Toybox.ActivityRecording;
using Toybox.Communications;
using Toybox.Lang;
using Toybox.Math;
using Toybox.Position;
using Toybox.Application.Storage;
using Toybox.System;
using Toybox.Time;
using Toybox.WatchUi;

class SessionStore {

    // Storage keys
    const KEY_ACTIVE = "zenith_active_session_v1";
    const KEY_OUTBOX = "zenith_outbox_v1";
    const KEY_LAST_DELIVERED_AT = "zenith_last_delivered_at_v1";
    const KEY_INSTALL_ID = "zenith_install_id_v1";

    // Session states (P0)
    const STATE_IDLE = "idle";
    const STATE_RECORDING = "recording";
    const STATE_PAUSED = "paused";
    const STATE_STOPPED = "stopped";

    // Workout kinds
    const KIND_RUN = "run";
    const KIND_LIFT = "lift";

    // End confirm window (ms)
    const END_ARM_WINDOW_MS = 2500;
    const SET_UNDO_WINDOW_MS = 5000;
    const ROUTE_SAMPLE_EVERY_MS = 5000;
    const MAX_ROUTE_PREVIEW_POINTS = 180;
    const TIMER_WRAP_MS = 2147483647;
    const MAX_ROUTE_HORIZONTAL_ACCURACY_M = 50.0;

    // Outbox limits
    const MAX_OUTBOX = 20;

    // Units
    const METERS_PER_MILE = 1609.344;
    // Time.now().value() is seconds since Garmin epoch (Dec 31 1989). Convert to Unix epoch seconds.
    const GARMIN_EPOCH_TO_UNIX_SEC = 631065600;

    // Transmit retry backoff (ms)
    const TX_BACKOFF_BASE_MS = 15000;
    const TX_BACKOFF_MAX_MS = 120000;

    var _session;
    var _active;
    var _endArmedAtMs;
    var _txInFlight;
    var _lastFlushAttemptMs;
    var _txFailCount;
    var _lastTxFailureAtMs;
    var _gpsEnabled;
    var _installId;
    var _phoneMethod;
    var _phoneInboxRegistered;

    function initialize() {
        _session = null;
        _active = null;
        _endArmedAtMs = 0;
        _txInFlight = false;
        _lastFlushAttemptMs = 0;
        _txFailCount = 0;
        _lastTxFailureAtMs = 0;
        _gpsEnabled = false;
        _installId = null;
        _phoneMethod = null;
        _phoneInboxRegistered = false;
        // Ensure comms pieces are wired even if the user never starts a workout this launch.
        onAppStart();
    }

    function onAppStart() {
        _ensureInstallId();
        _registerPhoneInboxBestEffort();
        // Outbox can contain a completed workout from a prior launch; try to flush immediately.
        flushOutbox();
    }

    function _normalizeTimerMs(ms) {
        var t = ms;
        if (!(t instanceof Number)) { return 0; }
        if (t < 0) { t = t + TIMER_WRAP_MS; }
        if (t >= TIMER_WRAP_MS) { t = t % TIMER_WRAP_MS; }
        if (t < 0) { t = 0; }
        return t;
    }

    function _timerNowMs() {
        return _normalizeTimerMs(System.getTimer());
    }

    function _timerDiffMs(startMs, nowMs) {
        var s = _normalizeTimerMs(startMs);
        var n = _normalizeTimerMs(nowMs);
        var d = n - s;
        if (d < 0) { d = d + TIMER_WRAP_MS; }
        return d;
    }

    function loadActive() {
        var raw = Storage.getValue(KEY_ACTIVE);
        if (raw == null) { return null; }
        if (raw instanceof Dictionary) { return raw; }
        return null;
    }

    function saveActive(active) {
        Storage.setValue(KEY_ACTIVE, active);
        _active = active;
    }

    function ensureLoaded() {
        if (_active == null) {
            _active = loadActive();
        }
    }

    function _ensureSessionHandleBestEffort() {
        // Conservative recovery:
        // only attempt to rebind when the persisted Zenith session explicitly expects a live handle.
        //
        // NOTE: Connect IQ does not provide an API to reattach to an existing ActivityRecording session
        // handle after a crash. This "recovery" necessarily creates a NEW session, so the FIT file will
        // only contain post-recovery data.
        if (_session != null) { return; }
        ensureLoaded();
        if (_active == null) { return; }
        var st = getState();
        if (st != STATE_RECORDING && st != STATE_PAUSED) { return; }

        var expected = _active.get("sessionHandleExpected");
        if (expected == null || !(expected instanceof Boolean) || !expected) { return; }
        var localSessionId = getSessionId();
        if (localSessionId == "") { return; }
        if (_activeString("endTimestamp") != "") { return; }
        var recoveryAttempted = _active.get("sessionRecoveryAttempted");
        if (recoveryAttempted != null && recoveryAttempted instanceof Boolean && recoveryAttempted) { return; }

        var info = null;
        try { info = Activity.getActivityInfo(); } catch(e) { info = null; }
        if (info == null) { return; }

        var kind = getKind();
        var sport = (kind == KIND_RUN) ? Activity.SPORT_RUNNING : Activity.SPORT_TRAINING;
        var subSport = Activity.SUB_SPORT_GENERIC;
        if (kind == KIND_RUN && getRunEnvironment() == "treadmill") {
            subSport = Activity.SUB_SPORT_TREADMILL;
        }
        try {
            _active.put("sessionRecoveryAttempted", true);
            _session = ActivityRecording.createSession({
                :name => (kind == KIND_RUN) ? "Zenith Run" : "Zenith Lift",
                :sport => sport,
                :subSport => subSport
            });
            _active.put("sessionRecovered", true);
            // Recovery reason fidelity (best-effort):
            // Compare stored uptime timer to current uptime timer to infer reboot vs app restart.
            var reason = "unknown";
            var notes = "";
            var storedLast = _active.get("lastTimerMs");
            var nowTimerMs = _timerNowMs();
            if (storedLast != null && storedLast instanceof Number) {
                if (nowTimerMs + 10000 < storedLast) {
                    reason = "device_reboot";
                } else {
                    reason = "app_restart";
                }
                notes = "timerNowMs=" + nowTimerMs.toString() + " lastTimerMs=" + storedLast.toString();
            }
            _active.put("recoveryReason", reason);
            _active.put("recoveryDetectedAt", Time.now().toString());
            if (notes != "") { _active.put("recoveryNotes", notes); }
            saveActive(_active);
        } catch(e2) {
            _session = null;
        }
    }

    function getState() {
        ensureLoaded();
        if (_active == null) { return STATE_IDLE; }
        var v = _active.get("state");
        if (v == null) { return STATE_IDLE; }
        if (v instanceof String) { return v; }
        return STATE_IDLE;
    }

    function getKind() {
        ensureLoaded();
        if (_active == null) { return ""; }
        var v = _active.get("kind");
        if (v == null) { return ""; }
        if (v instanceof String) { return v; }
        return "";
    }

    function getRunEnvironment() {
        ensureLoaded();
        if (_active == null) { return ""; }
        var v = _active.get("runEnvironment");
        if (v == null) { return ""; }
        if (v instanceof String) { return v; }
        return "";
    }

    function getSessionId() {
        ensureLoaded();
        if (_active == null) { return ""; }
        var v = _active.get("localSessionId");
        if (v == null) { return ""; }
        if (v instanceof String) { return v; }
        return "";
    }

    function getSessionRecovered() {
        ensureLoaded();
        if (_active == null) { return false; }
        var v = _active.get("sessionRecovered");
        if (v != null && v instanceof Boolean) { return v; }
        return false;
    }

    function getElapsedSec() {
        ensureLoaded();
        if (_active == null) { return 0; }
        var v = _active.get("elapsedSec");
        if (v == null) { return 0; }
        if (v instanceof Number) { return v; }
        return 0;
    }

    function getMovingSec() {
        ensureLoaded();
        if (_active == null) { return 0; }
        var v = _active.get("movingSec");
        if (v == null) { return 0; }
        if (v instanceof Number) { return v; }
        return 0;
    }

    function getPausedSec() {
        ensureLoaded();
        if (_active == null) { return 0; }
        var v = _active.get("pausedSec");
        if (v == null) { return 0; }
        if (v instanceof Number) { return v; }
        return 0;
    }

    function getEndTimestamp() {
        ensureLoaded();
        if (_active == null) { return ""; }
        var v = _active.get("endTimestamp");
        if (v == null) { return ""; }
        if (v instanceof String) { return v; }
        return "";
    }

    function _activeString(key) {
        if (_active == null) { return ""; }
        var v = _active.get(key);
        if (v != null && v instanceof String) { return v; }
        return "";
    }

    function _activeNumericOrNull(key) {
        if (_active == null) { return null; }
        var v = _active.get(key);
        if (v == null) { return null; }
        if (v instanceof Number) { return v; }
        if (v instanceof Float) { return v; }
        if (v instanceof Double) { return v; }
        if (v instanceof Long) { return v; }
        return null;
    }

    function _safeErrorString(err) {
        if (err == null) { return "unknown"; }
        try { return err.toString(); } catch(e) { return "unknown"; }
    }

    function _onPosition(info as Position.Info) as Void {
        // No-op: enabling events improves Position.getInfo() freshness on some devices.
        // We still use polling capture to control sampling + storage volume.
    }

    function _setGpsEnabledBestEffort(enabled) {
        if (!(Position has :enableLocationEvents)) { return; }
        if (enabled) {
            if (_gpsEnabled) { return; }
            try {
                Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:_onPosition));
                _gpsEnabled = true;
            } catch(e) {
                _gpsEnabled = false;
                _recordOperationalIssue("gps_enable_failed", e);
            }
            return;
        }

        if (!_gpsEnabled) { return; }
        try {
            Position.enableLocationEvents(Position.LOCATION_DISABLE, null);
        } catch(e2) {
            _recordOperationalIssue("gps_disable_failed", e2);
        }
        _gpsEnabled = false;
    }

    function _recordOperationalIssue(code, err) {
        ensureLoaded();
        var at = Time.now().toString();
        var detail = _safeErrorString(err);
        if (_active != null) {
            _active.put("lastOperationalIssueCode", code);
            _active.put("lastOperationalIssueAt", at);
            _active.put("lastOperationalIssueDetail", detail);
            saveActive(_active);
        }
        System.println("[SessionStore] " + code + " " + detail);
    }

    // Live metrics accessors (best-effort)
    function getDistanceMeters() {
        ensureLoaded();
        if (_active == null) { return null; }
        return _activeNumericOrNull("distanceMeters");
    }

    function getPaceMinPerMile() {
        ensureLoaded();
        if (_active == null) { return null; }
        return _activeNumericOrNull("paceMinPerMile");
    }

    function getPaceIsEstimated() {
        ensureLoaded();
        if (_active == null) { return false; }
        var v = _active.get("paceIsEstimated");
        if (v != null && v instanceof Boolean) { return v; }
        return false;
    }

    function getHeartRateBpm() {
        ensureLoaded();
        if (_active == null) { return null; }
        return _activeNumericOrNull("currentHeartRate");
    }

    function getAvgHeartRateBpm() {
        ensureLoaded();
        if (_active == null) { return null; }
        return _activeNumericOrNull("avgHeartRate");
    }

    function getMaxHeartRateBpm() {
        ensureLoaded();
        if (_active == null) { return null; }
        return _activeNumericOrNull("maxHeartRate");
    }

    function getCalories() {
        ensureLoaded();
        if (_active == null) { return null; }
        return _activeNumericOrNull("calories");
    }

    function getSetCount() {
        ensureLoaded();
        if (_active == null) { return 0; }
        var v = _active.get("setCount");
        if (v == null) { return 0; }
        if (v instanceof Number) { return v; }
        return 0;
    }

    function getIntensityBand() {
        ensureLoaded();
        if (_active == null) { return "low"; }
        var v = _active.get("intensityBand");
        if (v == null) { return "low"; }
        if (v instanceof String) { return v; }
        return "low";
    }

    function setUndoIsArmed() {
        ensureLoaded();
        if (_active == null) { return false; }
        var nowMs = _timerNowMs();
        var armedAt = _active.get("setUndoArmedAtMs");
        if (armedAt != null && armedAt instanceof Number) {
            return _timerDiffMs(armedAt, nowMs) <= SET_UNDO_WINDOW_MS;
        }
        // Back-compat: older persisted payloads used an absolute "until" deadline.
        var until = _active.get("setUndoUntilMs");
        if (until != null && until instanceof Number) {
            return _timerDiffMs(nowMs, until) <= SET_UNDO_WINDOW_MS;
        }
        return false;
    }

    function tick() {
        ensureLoaded();
        if (_active == null) { return; }

        var state = getState();
        if (state != STATE_RECORDING && state != STATE_PAUSED) { return; }

        var nowMs = _timerNowMs();
        // Persist last uptime timer so crash recovery can infer reboot vs app restart.
        _active.put("lastTimerMs", nowMs);
        _ensureSessionHandleBestEffort();
        var startTimerMs = nowMs;
        var st = _active.get("startTimerMs");
        if (st != null && st instanceof Number) { startTimerMs = st; }

        // Total elapsed includes pauses.
        var totalElapsedSec = _timerDiffMs(startTimerMs, nowMs) / 1000; // integer division

        // Paused time accumulation in milliseconds to avoid truncation drift.
        var pausedMs = 0;
        var pm = _active.get("pausedMs");
        if (pm != null && pm instanceof Number) { pausedMs = pm; }
        if (state == STATE_PAUSED) {
            var pStart = _active.get("pauseStartMs");
            if (pStart != null && pStart instanceof Number) {
                var addPauseMs = _timerDiffMs(pStart, nowMs);
                if (addPauseMs > 0) {
                    pausedMs = pausedMs + addPauseMs;
                    _active.put("pauseStartMs", nowMs);
                }
            }
        }
        var pausedSec = pausedMs / 1000;

        var movingSec = totalElapsedSec - pausedSec;
        if (movingSec < 0) { movingSec = 0; }

        _active.put("elapsedSec", totalElapsedSec);
        _active.put("pausedMs", pausedMs);
        _active.put("pausedSec", pausedSec);
        _active.put("movingSec", movingSec);

        // Live metrics: refresh only while recording; when paused we freeze.
        if (state == STATE_RECORDING) {
            _refreshMetricsBestEffort(nowMs);
            if (getKind() == KIND_RUN && getRunEnvironment() == "outdoor") {
                _captureRoutePointBestEffort(nowMs);
            }
            if (getKind() == KIND_LIFT) {
                var c = getCalories();
                var band = "low";
                if (c != null && c instanceof Number) {
                    if (c >= 250) { band = "high"; }
                    else if (c >= 120) { band = "moderate"; }
                }
                _active.put("intensityBand", band);
            }
        }

        saveActive(_active);

        // Opportunistic outbox retries (P0: avoid dropping summaries when phone link is flaky).
        if (!_txInFlight && _timerDiffMs(_lastFlushAttemptMs, nowMs) > 15000) {
            flushOutbox();
        }

        // Live metrics streaming (gated): periodic snapshot while recording.
        _maybeQueueLiveSnapshot(nowMs);
    }

    function _maybeQueueLiveSnapshot(nowMs) {
        if (_active == null) { return; }
        if (getState() != STATE_RECORDING) { return; }

        var lastAt = _active.get("lastSnapshotQueuedAtMs");
        if (lastAt != null && lastAt instanceof Number) {
            if (_timerDiffMs(lastAt, nowMs) < 4000) { // 4s cadence (2–5s target)
                return;
            }
        }

        var seq = _active.get("snapshotSeq");
        if (seq == null || !(seq instanceof Number)) { seq = 0; }
        seq = seq + 1;
        _active.put("snapshotSeq", seq);
        _active.put("lastSnapshotQueuedAtMs", nowMs);

        var payload = {
            "localSessionId" => getSessionId(),
            "sportType" => getKind(),
            "state" => getState(),
            "seq" => seq,
            "sentAt" => Time.now().toString(),
            "elapsedTimeSeconds" => getElapsedSec(),
            "movingTimeSec" => getMovingSec(),
            "pausedTotalSec" => getPausedSec(),
            "distanceMeters" => getDistanceMeters(),
            "paceMinPerMile" => getPaceMinPerMile(),
            "paceIsEstimated" => getPaceIsEstimated(),
            "currentHeartRate" => getHeartRateBpm(),
            "avgHeartRate" => getAvgHeartRateBpm(),
            "maxHeartRate" => getMaxHeartRateBpm(),
            "hrAvailable" => _active.get("hrAvailable"),
            "calories" => getCalories(),
            "setCount" => getSetCount(),
            "intensityBand" => getIntensityBand(),
            "runEnvironment" => getRunEnvironment()
        };

        _queueOutbox("WORKOUT_SNAPSHOT", payload);
    }

    function forceClear(reason) {
        // Escape hatch: never leave the user in a save/discard dead-end.
        var why = (reason != null) ? reason.toString() : "unknown";
        _setGpsEnabledBestEffort(false);
        ensureLoaded();

        if (_session != null) {
            try { _session.discard(); } catch(e) { _recordOperationalIssue("force_clear_discard_failed", e); }
        }
        _session = null;
        _endArmedAtMs = 0;
        saveActive(null);

        _queueOutbox("FORCE_CLEARED", {
            "reason" => why,
            "clearedAt" => Time.now().toString()
        });

        try { WatchUi.requestUpdate(); } catch(eUi) { }
    }

    function _ensureInstallId() {
        if (_installId != null && _installId instanceof String && _installId != "") {
            return _installId;
        }
        var raw = Storage.getValue(KEY_INSTALL_ID);
        if (raw != null && raw instanceof String && raw != "") {
            _installId = raw;
            return _installId;
        }
        var created = _makeId("install");
        Storage.setValue(KEY_INSTALL_ID, created);
        _installId = created;
        return _installId;
    }

    function _registerPhoneInboxBestEffort() {
        if (_phoneInboxRegistered) { return; }
        if (!(Communications has :registerForPhoneAppMessages)) { return; }
        if (_phoneMethod == null) { _phoneMethod = method(:_onPhoneMessage); }
        try {
            Communications.registerForPhoneAppMessages(_phoneMethod);
            _phoneInboxRegistered = true;
        } catch(eReg) {
            _phoneInboxRegistered = false;
        }
    }

    function _onPhoneMessage(msg) {
        var data = (msg != null) ? msg.data : null;
        if (data == null || !(data instanceof Dictionary)) { return; }

        var protocol = data.get("protocolVersion");
        if (protocol != null && protocol instanceof Number && protocol != 1) { return; }

        var commandId = data.get("commandId");
        if (commandId == null) { commandId = data.get("clientCommandId"); }
        var sessionId = data.get("sessionId");
        var type = data.get("type");
        if (type == null) { type = data.get("commandType"); }

        var cmd = (type != null) ? type.toString() : "";
        var cid = (commandId != null) ? commandId.toString() : "";
        var sid = (sessionId != null) ? sessionId.toString() : "";

        // Reject session-scoped commands when sessionId mismatches.
        var currentSid = getSessionId();
        if (sid != "" && currentSid != "" && sid != currentSid) {
            _queueOutbox("COMMAND_ACK", {
                "commandId" => cid,
                "sessionId" => sid,
                "accepted" => false,
                "reason" => "session_mismatch",
                "state" => getState(),
                "ackedAt" => Time.now().toString()
            });
            return;
        }

        var accepted = false;
        var reason = "";
        try {
            if (cmd == "pause") {
                if (getState() == STATE_RECORDING) { pause(); accepted = true; } else { reason = "invalid_state"; }
            } else if (cmd == "resume") {
                if (getState() == STATE_PAUSED) { resume(); accepted = true; } else { reason = "invalid_state"; }
            } else if (cmd == "end" || cmd == "stop") {
                if (getState() == STATE_RECORDING || getState() == STATE_PAUSED) { stop(); accepted = true; } else { reason = "invalid_state"; }
            } else if (cmd == "save") {
                if (getState() == STATE_STOPPED) { accepted = save(); if (!accepted) { reason = "save_failed"; } } else { reason = "invalid_state"; }
            } else if (cmd == "discard") {
                accepted = discard();
                if (!accepted) { reason = "discard_failed"; }
            } else if (cmd == "forceClear") {
                forceClear("remote_command");
                accepted = true;
            } else {
                reason = "unknown_command";
            }
        } catch(eCmd) {
            accepted = false;
            reason = "exception";
            _recordOperationalIssue("phone_command_exception", eCmd);
        }

        // Always ACK commands so the phone can stop retrying.
        var ackPayload = {
            "commandId" => cid,
            "sessionId" => (currentSid != "") ? currentSid : sid,
            "accepted" => accepted,
            "reason" => (reason != "") ? reason : null,
            "state" => getState(),
            "ackedAt" => Time.now().toString()
        };
        _queueOutbox("COMMAND_ACK", ackPayload);

        try { WatchUi.requestUpdate(); } catch(eUi) { }
    }

    function _appendSpeedSample(samples, v) {
        if (samples == null || !(samples instanceof Array)) { samples = []; }
        samples.add(v);
        if (samples.size() > 6) {
            samples = samples.slice(samples.size() - 6, samples.size());
        }
        return samples;
    }

    function _avgNonZero(samples) {
        if (samples == null || !(samples instanceof Array) || samples.size() == 0) { return null; }
        var sum = 0.0;
        var n = 0;
        for (var i = 0; i < samples.size(); i++) {
            var v = samples[i];
            if (v != null && v == v && v > 0.1) {
                sum += v;
                n++;
            }
        }
        if (n == 0) { return null; }
        return sum / n;
    }

    function _refreshMetricsBestEffort(nowMs) {
        // Pull runtime metrics from the system activity engine (best-effort).
        var info = null;
        try { info = Activity.getActivityInfo(); } catch(e) { info = null; }
        if (info == null) { return; }

        // Distance (meters): the activity engine provides best-effort distance for both outdoor and treadmill runs.
        var rawDist = null;
        try { rawDist = info.elapsedDistance; } catch(e2) { rawDist = null; }
        if (rawDist != null && rawDist == rawDist && rawDist >= 0) {
            var pausedDist = 0.0;
            var pd = _active.get("pausedDistanceMeters");
            if (pd != null && (pd instanceof Number || pd instanceof Float || pd instanceof Double || pd instanceof Long)) { pausedDist = pd; }
            var dist = rawDist - pausedDist;
            if (dist < 0) { dist = 0; }
            _active.put("distanceMeters", dist);
        }

        // Calories
        var cal = null;
        try { cal = info.calories; } catch(e3) { cal = null; }
        if (cal != null && cal == cal && cal >= 0) {
            _active.put("calories", cal);
        }

        // Heart rate (truthful; only set hrAvailable if we can read current HR).
        var hr = null;
        var hrAvg = null;
        var hrMax = null;
        try { hr = info.currentHeartRate; } catch(e4) { hr = null; }
        try { hrAvg = info.averageHeartRate; } catch(e5) { hrAvg = null; }
        try { hrMax = info.maxHeartRate; } catch(e6) { hrMax = null; }
        if (hr != null && hr == hr && hr > 0) {
            _active.put("currentHeartRate", hr);
            _active.put("hrAvailable", true);
        }
        if (hrAvg != null && hrAvg == hrAvg && hrAvg > 0) { _active.put("avgHeartRate", hrAvg); }
        if (hrMax != null && hrMax == hrMax && hrMax > 0) { _active.put("maxHeartRate", hrMax); }

        // Speed + pace smoothing
        var speed = null;
        try { speed = info.currentSpeed; } catch(e7) { speed = null; }
        var usedDerivedSpeed = false;

        // Fallback: if currentSpeed is unavailable (common on treadmill), derive from distance delta
        // using an adaptive window so slow walks can still produce a stable estimate.
        if (speed == null || speed != speed || speed < 0) {
            var elapsedSec = getElapsedSec();
            var baselineDist = _active.get("derivedBaselineDistanceMeters");
            var baselineAt = _active.get("derivedBaselineAtMs");
            var hasBaseline = (
                baselineDist != null && (baselineDist instanceof Number || baselineDist instanceof Float || baselineDist instanceof Double || baselineDist instanceof Long) &&
                baselineAt != null && baselineAt instanceof Number
            );
            if (!hasBaseline) {
                if (rawDist != null && rawDist == rawDist && rawDist >= 0) {
                    _active.put("derivedBaselineDistanceMeters", rawDist);
                    _active.put("derivedBaselineAtMs", nowMs);
                }
            } else {
                var dtMs = _timerDiffMs(baselineAt, nowMs);
                // If baseline is too old, reset rather than producing nonsense.
                if (dtMs <= 0 || dtMs > 20000) {
                    _active.put("derivedBaselineDistanceMeters", rawDist);
                    _active.put("derivedBaselineAtMs", nowMs);
                } else {
                    var delta = rawDist - baselineDist;
                    if (delta != null && delta == delta && delta >= 0) {
                        // Stability guard: don't compute until we have enough movement/time.
                        if (elapsedSec >= 10 && delta >= 10.0) {
                            speed = delta / (dtMs.toFloat() / 1000.0);
                            usedDerivedSpeed = true;
                            // Move the window forward once used so the estimate remains responsive.
                            _active.put("derivedBaselineDistanceMeters", rawDist);
                            _active.put("derivedBaselineAtMs", nowMs);
                        }
                    } else {
                        _active.put("derivedBaselineDistanceMeters", rawDist);
                        _active.put("derivedBaselineAtMs", nowMs);
                    }
                }
            }
        } else {
            // If we have true speed again, clear derived baseline.
            _active.put("derivedBaselineAtMs", null);
            _active.put("derivedBaselineDistanceMeters", null);
        }

        if (speed != null && speed == speed && speed >= 0) {
            var samples = _active.get("speedSamplesMps");
            samples = _appendSpeedSample(samples, speed);
            _active.put("speedSamplesMps", samples);

            var smoothed = _avgNonZero(samples);
            if (smoothed != null && smoothed == smoothed && smoothed > 0.1) {
                var paceMinPerMile = (METERS_PER_MILE / smoothed) / 60.0;
                // Defensive bounds (avoid NaN/Inf if speed is weird).
                if (paceMinPerMile > 0 && paceMinPerMile < 120.0) {
                    _active.put("paceMinPerMile", paceMinPerMile);
                    _active.put("paceIsEstimated", usedDerivedSpeed);
                } else {
                    _active.put("paceMinPerMile", null);
                    _active.put("paceIsEstimated", false);
                }
            } else {
                _active.put("paceMinPerMile", null);
                _active.put("paceIsEstimated", false);
            }
        } else {
            _active.put("paceMinPerMile", null);
            _active.put("paceIsEstimated", false);
        }

        // Track last raw distance sample for potential future fallback.
        if (rawDist != null && rawDist == rawDist && rawDist >= 0) {
            _active.put("lastRawDistanceMeters", rawDist);
            _active.put("lastRawDistanceAtMs", nowMs);
        }
    }

    function _captureRoutePointBestEffort(nowMs) {
        if (_active == null) { return; }
        var lastMs = _active.get("routeLastSampleMs");
        if (lastMs != null && lastMs instanceof Number) {
            if (_timerDiffMs(lastMs, nowMs) < ROUTE_SAMPLE_EVERY_MS) { return; }
        }

        var pInfo = null;
        try { pInfo = Position.getInfo(); } catch(e) { pInfo = null; }
        if (pInfo == null) { return; }

        // Connect IQ: Position.Info.accuracy is a Position.Quality enum (NOT_AVAILABLE..GOOD).
        // Reject points below usable quality.
        var quality = null;
        try { if (pInfo has :accuracy) { quality = pInfo.accuracy; } } catch(e2) { quality = null; }
        if (quality != null && quality instanceof Number) {
            if (quality < Position.QUALITY_USABLE) { return; }
        }

        var lat = null;
        var lon = null;
        try {
            if (pInfo has :position && pInfo.position != null) {
                var deg = pInfo.position.toDegrees();
                if (deg != null && deg instanceof Array && deg.size() >= 2) {
                    lat = deg[0];
                    lon = deg[1];
                }
            }
        } catch(e5) { lat = null; lon = null; }

        if (lat == null || lon == null) { return; }
        if (lat != lat || lon != lon) { return; }
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) { return; }

        var points = _active.get("routePoints");
        if (points == null || !(points instanceof Array)) { points = []; }

        var tsEpochMs = 0;
        try { tsEpochMs = (Time.now().value() + GARMIN_EPOCH_TO_UNIX_SEC) * 1000; } catch(eTs) { tsEpochMs = 0; }
        points.add({
            "latitude" => lat,
            "longitude" => lon,
            "timestamp" => tsEpochMs
        });
        if (points.size() > MAX_ROUTE_PREVIEW_POINTS) {
            points = points.slice(points.size() - MAX_ROUTE_PREVIEW_POINTS, points.size());
        }
        _active.put("routePoints", points);
        _active.put("routeLastSampleMs", nowMs);
    }

    function start(kind, runEnvironment) {
        ensureLoaded();
        var state = getState();
        if (state == STATE_RECORDING || state == STATE_PAUSED) { return false; }

        var nowIso = Time.now().toString();
        var localSessionId = _makeId("zenith_" + kind);
        var sport = (kind == KIND_RUN) ? Activity.SPORT_RUNNING : Activity.SPORT_TRAINING;
        var subSport = Activity.SUB_SPORT_GENERIC;
        var env = "";
        if (kind == KIND_RUN) {
            if (runEnvironment == null || !(runEnvironment instanceof String) || runEnvironment == "") {
                env = "outdoor";
            } else {
                env = runEnvironment;
            }
            if (env == "treadmill") {
                subSport = Activity.SUB_SPORT_TREADMILL;
            }
        }

        var session = null;
        try {
            session = ActivityRecording.createSession({
                :name => (kind == KIND_RUN) ? "Zenith Run" : "Zenith Lift",
                :sport => sport,
                :subSport => subSport
            });
        } catch(eCreate) {
            _recordOperationalIssue("start_create_session_failed", eCreate);
            _session = null;
            return false;
        }

        _session = session;
        try {
            session.start();
        } catch(eStart) {
            _recordOperationalIssue("start_session_start_failed", eStart);
            try { session.discard(); } catch(eDiscard) {
                _recordOperationalIssue("start_session_discard_failed", eDiscard);
            }
            _session = null;
            return false;
        }

        var nowMs = _timerNowMs();
        _active = {
            "localSessionId" => localSessionId,
            "kind" => kind,
            "runEnvironment" => env,
            "state" => STATE_RECORDING,
            "startTimestamp" => nowIso,
            "endTimestamp" => null,
            // Timer breadcrumb for recovery reason fidelity.
            "lastTimerMs" => nowMs,
            "recoveryReason" => null,
            "recoveryDetectedAt" => null,
            "recoveryNotes" => null,
            // Time accounting
            "startTimerMs" => nowMs,
            "elapsedSec" => 0,
            "movingSec" => 0,
            "pausedMs" => 0,
            "pausedSec" => 0,
            "pauseStartMs" => null,

            // Distance pause-correction
            "pausedDistanceMeters" => 0.0,
            "pauseStartDistanceMeters" => null,

            // Live metrics cache
            "distanceMeters" => null,
            "paceMinPerMile" => null,
            "paceIsEstimated" => false,
            "speedSamplesMps" => [],
            "currentHeartRate" => null,
            "avgHeartRate" => null,
            "maxHeartRate" => null,
            "hrAvailable" => false,
            "calories" => null,
            // Route preview (outdoor run only)
            "routePoints" => [],
            "routeLastSampleMs" => 0,
            // Lift-only metrics
            "setCount" => 0,
            "intensityBand" => "low",
            "setUndoArmedAtMs" => 0,
            "sessionHandleExpected" => true,
            "sessionRecoveryAttempted" => false,
            "sessionRecovered" => false
        };
        saveActive(_active);

        // Enable GPS events for outdoor route preview; improves Position.getInfo() freshness on some devices.
        if (kind == KIND_RUN && env == "outdoor") {
            _setGpsEnabledBestEffort(true);
        } else {
            _setGpsEnabledBestEffort(false);
        }

        var startPayload = {
            "localSessionId" => localSessionId,
            "sportType" => kind,
            "startTimestamp" => nowIso
        };
        if (env != "") { startPayload.put("runEnvironment", env); }
        _queueOutbox("WORKOUT_STARTED", startPayload);

        return true;
    }

    function pause() {
        ensureLoaded();
        if (_active == null) { return; }
        if (getState() != STATE_RECORDING) { return; }
        _ensureSessionHandleBestEffort();

        tick(); // captures latest metrics/time first
        _active.put("state", STATE_PAUSED);
        _active.put("pauseStartMs", _timerNowMs());

        // Track distance at pause so we can subtract any accumulation while paused.
        var info = null;
        try { info = Activity.getActivityInfo(); } catch(e) { info = null; }
        if (info != null) {
            try {
                var raw = info.elapsedDistance;
                if (raw != null && raw == raw && raw >= 0) {
                    _active.put("pauseStartDistanceMeters", raw);
                }
            } catch(e2) {
                _recordOperationalIssue("pause_distance_read_failed", e2);
            }
        }
        saveActive(_active);

        if (getKind() == KIND_RUN && getRunEnvironment() == "outdoor") {
            _setGpsEnabledBestEffort(false);
        }

        _queueOutbox("WORKOUT_PAUSED", {
            "localSessionId" => getSessionId(),
            "sportType" => getKind(),
            "pausedAt" => Time.now().toString()
        });
    }

    function resume() {
        ensureLoaded();
        if (_active == null) { return; }
        if (getState() != STATE_PAUSED) { return; }
        _ensureSessionHandleBestEffort();

        // Correct distance accumulation during pause (best-effort).
        var pauseStartDist = null;
        var psd = _active.get("pauseStartDistanceMeters");
        if (psd != null && psd instanceof Number) { pauseStartDist = psd; }
        if (pauseStartDist != null) {
            var info = null;
            try { info = Activity.getActivityInfo(); } catch(e) { info = null; }
            if (info != null) {
                try {
                    var nowRaw = info.elapsedDistance;
                    if (nowRaw != null && nowRaw == nowRaw && nowRaw >= 0) {
                        var pausedDist = _active.get("pausedDistanceMeters");
                        if (pausedDist == null || !(pausedDist instanceof Number || pausedDist instanceof Float || pausedDist instanceof Double || pausedDist instanceof Long)) { pausedDist = 0.0; }
                        var add = nowRaw - pauseStartDist;
                        if (add > 0) { pausedDist = pausedDist + add; }
                        _active.put("pausedDistanceMeters", pausedDist);
                    }
                } catch(e2) {
                    _recordOperationalIssue("resume_distance_correction_failed", e2);
                }
            }
        }

        _active.put("pauseStartMs", null);
        _active.put("pauseStartDistanceMeters", null);
        _active.put("state", STATE_RECORDING);

        // Reset smoothing so we don't show stale pace immediately.
        _active.put("speedSamplesMps", []);
        _active.put("derivedBaselineAtMs", null);
        _active.put("derivedBaselineDistanceMeters", null);

        saveActive(_active);

        if (getKind() == KIND_RUN && getRunEnvironment() == "outdoor") {
            _setGpsEnabledBestEffort(true);
        }

        _queueOutbox("WORKOUT_RESUMED", {
            "localSessionId" => getSessionId(),
            "sportType" => getKind(),
            "resumedAt" => Time.now().toString()
        });
    }

    function addSet() {
        ensureLoaded();
        if (_active == null) { return; }
        if (getKind() != KIND_LIFT) { return; }
        var st = getState();
        if (st != STATE_RECORDING && st != STATE_PAUSED) { return; }

        var sets = getSetCount();
        _active.put("setCount", sets + 1);
        var nowMs = _timerNowMs();
        _active.put("setUndoArmedAtMs", nowMs);
        // Also persist a deadline for back-compat readers.
        _active.put("setUndoUntilMs", _normalizeTimerMs(nowMs + SET_UNDO_WINDOW_MS));
        saveActive(_active);
    }

    function undoSet() {
        ensureLoaded();
        if (_active == null) { return; }
        if (getKind() != KIND_LIFT) { return; }
        if (!setUndoIsArmed()) { return; }
        var sets = getSetCount();
        if (sets > 0) { _active.put("setCount", sets - 1); }
        saveActive(_active);
    }

    function armEnd() {
        _endArmedAtMs = _timerNowMs();
    }

    function endIsArmed() {
        if (_endArmedAtMs <= 0) { return false; }
        return _timerDiffMs(_endArmedAtMs, _timerNowMs()) <= END_ARM_WINDOW_MS;
    }

    function stop() {
        ensureLoaded();
        if (_active == null) { return; }
        if (getState() != STATE_RECORDING && getState() != STATE_PAUSED) { return; }
        _ensureSessionHandleBestEffort();

        tick();
        _setGpsEnabledBestEffort(false);
        _endArmedAtMs = 0;
        _active.put("state", STATE_STOPPED);
        _active.put("endTimestamp", Time.now().toString());
        _active.put("sessionHandleExpected", false);
        // lift intensity estimation from calories (simple parity with Apple banding)
        if (getKind() == KIND_LIFT) {
            var c = getCalories();
            var band = "low";
            if (c != null && c instanceof Number) {
                if (c >= 250) { band = "high"; }
                else if (c >= 120) { band = "moderate"; }
            }
            _active.put("intensityBand", band);
        }
        saveActive(_active);

        if (_session != null) {
            try { _session.stop(); } catch(e) {
                _recordOperationalIssue("stop_session_stop_failed", e);
            }
        }

        // Summary P0: distance/calories/hr are best-effort and may be null.
        var dist = getDistanceMeters();
        var hrAvail = false;
        var hrA = getAvgHeartRateBpm();
        var hrM = getMaxHeartRateBpm();
        var hrC = getHeartRateBpm();
        var ha = _active.get("hrAvailable");
        if (ha != null && ha instanceof Boolean) { hrAvail = ha; }
        if (hrC != null && hrC instanceof Number && hrC > 0) { hrAvail = true; }

        var devModel = "unknown";
        var ds = null;
        try { ds = System.getDeviceSettings(); } catch(eDs) { ds = null; }
        if (ds != null) {
            try { if (ds has :partNumber && ds.partNumber != null) { devModel = ds.partNumber.toString(); } } catch(ePn) {}
            if (devModel == "unknown") {
                try { if (ds has :modelNumber && ds.modelNumber != null) { devModel = ds.modelNumber.toString(); } } catch(eMn) {}
            }
            if (devModel == "unknown") {
                try { if (ds has :productId && ds.productId != null) { devModel = ds.productId.toString(); } } catch(ePid) {}
            }
        }

        var stopPayload = {
            "localSessionId" => getSessionId(),
            "sportType" => getKind(),
            "startTimestamp" => _activeString("startTimestamp"),
            "endTimestamp" => _activeString("endTimestamp"),
            "elapsedTimeSeconds" => getElapsedSec(),
            "movingTimeSec" => getMovingSec(),
            "movingTimeSeconds" => getMovingSec(),
            "pausedTotalSec" => getPausedSec(),
            "distanceMeters" => dist,
            "totalDistanceMiles" => (dist != null) ? (dist / METERS_PER_MILE) : null,
            "runEnvironment" => getRunEnvironment(),
            "avgHeartRate" => hrA,
            "maxHeartRate" => hrM,
            "hrAvailable" => hrAvail,
            "calories" => getCalories(),
            "totalCalories" => getCalories(),
            "setCount" => getSetCount(),
            "intensityBand" => getIntensityBand(),
            "fitFileSaved" => (_session != null),
            "sessionRecovered" => (_active != null && _active.get("sessionRecovered") instanceof Boolean) ? _active.get("sessionRecovered") : false,
            "recoveryReason" => (_activeString("recoveryReason") != "") ? _activeString("recoveryReason") : null,
            "recoveryDetectedAt" => (_activeString("recoveryDetectedAt") != "") ? _activeString("recoveryDetectedAt") : null,
            "recoveryNotes" => (_activeString("recoveryNotes") != "") ? _activeString("recoveryNotes") : null,
            "deviceModel" => devModel
        };
        if (getKind() == KIND_RUN && getRunEnvironment() == "outdoor") {
            var route = _active.get("routePoints");
            if (route != null && route instanceof Array && route.size() > 0) {
                stopPayload.put("route", route);
            }
        }
        _queueOutbox("WORKOUT_STOPPED", stopPayload);
    }

    function save() {
        ensureLoaded();
        if (_active == null) { return false; }
        if (getState() != STATE_STOPPED) { return false; }
        _ensureSessionHandleBestEffort();
        _setGpsEnabledBestEffort(false);

        var fitSaved = false;
        if (_session != null) {
            try {
                _session.save();
                fitSaved = true;
            } catch(e) {
                _recordOperationalIssue("save_session_save_failed", e);
                fitSaved = false;
            }
        } else {
            fitSaved = false;
        }

        if (fitSaved) {
            _queueOutbox("WORKOUT_SAVED", {
                "localSessionId" => getSessionId(),
                "sportType" => getKind(),
                "savedAt" => Time.now().toString(),
                "fitFileSaved" => true
            });

            _endArmedAtMs = 0;
            saveActive(null);
            _session = null;
            return true;
        }

        // Save failure must be surfaced and must not silently clear the only in-memory session.
        // User can retry save, discard, or Force Clear from the error view.
        try { _active.put("fitSaveFailed", true); } catch(eFlag) { }
        _queueOutbox("WORKOUT_SAVE_FAILED", {
            "localSessionId" => getSessionId(),
            "sportType" => getKind(),
            "failedAt" => Time.now().toString(),
            "fitFileSaved" => false
        });
        saveActive(_active);

        return false;
    }

    function discard() {
        ensureLoaded();
        if (_active == null && _session == null) { return false; }
        _ensureSessionHandleBestEffort();
        _setGpsEnabledBestEffort(false);
        var discardOk = true;
        if (_session != null) {
            try { _session.discard(); } catch(e) {
                _recordOperationalIssue("discard_session_discard_failed", e);
                discardOk = false;
            }
        }

        if (_active != null) {
            _active.put("sessionHandleExpected", false);
            _queueOutbox("WORKOUT_DISCARDED", {
                "localSessionId" => getSessionId(),
                "sportType" => getKind(),
                "discardedAt" => Time.now().toString()
            });
        }

        saveActive(null);
        _endArmedAtMs = 0;
        _session = null;
        return discardOk;
    }

    function lastDeliveredAt() {
        var raw = Storage.getValue(KEY_LAST_DELIVERED_AT);
        if (raw == null) { return ""; }
        if (raw instanceof String) { return raw; }
        return "";
    }

    // Outbox / transmit
    function _loadOutbox() {
        var raw = Storage.getValue(KEY_OUTBOX);
        if (raw == null) { return []; }
        if (raw instanceof Array) { return raw; }
        return [];
    }

    function _saveOutbox(items) {
        Storage.setValue(KEY_OUTBOX, items);
    }

    function _queueOutbox(messageType, payload) {
        var outbox = _loadOutbox();
        _ensureInstallId();
        var localSessionId = "";
        if (payload != null && payload instanceof Dictionary) {
            try {
                var sid = payload.get("localSessionId");
                if (sid != null) { localSessionId = sid.toString(); }
            } catch(eSid) { localSessionId = ""; }
        }

        // Dedupe: pause/resume events are high-volume; keep only the latest for this session.
        if (localSessionId != "" && (messageType == "WORKOUT_PAUSED" || messageType == "WORKOUT_RESUMED")) {
            var filtered = [];
            for (var i = 0; i < outbox.size(); i += 1) {
                var it = outbox[i];
                if (it == null || !(it instanceof Dictionary)) { continue; }
                var mt = it.get("messageType");
                var pl = it.get("payload");
                var itSid = "";
                if (pl != null && pl instanceof Dictionary) {
                    try { var s2 = pl.get("localSessionId"); if (s2 != null) { itSid = s2.toString(); } } catch(eS2) { itSid = ""; }
                }
                if (itSid == localSessionId && (mt == "WORKOUT_PAUSED" || mt == "WORKOUT_RESUMED")) {
                    // drop
                } else {
                    filtered.add(it);
                }
            }
            outbox = filtered;
        }

        // Dedupe: keep only the newest message of the same type for a given session.
        if (localSessionId != "") {
            var filtered2 = [];
            for (var j = 0; j < outbox.size(); j += 1) {
                var it2 = outbox[j];
                if (it2 == null || !(it2 instanceof Dictionary)) { continue; }
                var mt2 = it2.get("messageType");
                var pl2 = it2.get("payload");
                var itSid2 = "";
                if (pl2 != null && pl2 instanceof Dictionary) {
                    try { var s3 = pl2.get("localSessionId"); if (s3 != null) { itSid2 = s3.toString(); } } catch(eS3) { itSid2 = ""; }
                }
                if (itSid2 == localSessionId && mt2 == messageType) {
                    // drop older duplicate
                } else {
                    filtered2.add(it2);
                }
            }
            outbox = filtered2;
        }

        var env = {
            "messageId" => _makeId(messageType),
            "protocolVersion" => 1,
            "installId" => _installId,
            "messageType" => messageType,
            "sentAt" => Time.now().toString(),
            "source" => "watch",
            "payload" => payload
        };
        outbox.add(env);
        if (outbox.size() > MAX_OUTBOX) {
            // Never evict terminal summaries just because pause/resume spam filled the queue.
            // Drop oldest high-volume messages first; only then fall back to keeping the newest N.
            while (outbox.size() > MAX_OUTBOX) {
                var removed = false;
                for (var k = 0; k < outbox.size(); k += 1) {
                    var it3 = outbox[k];
                    if (it3 == null || !(it3 instanceof Dictionary)) { continue; }
                    var mt3 = it3.get("messageType");
                    if (mt3 == "WORKOUT_SNAPSHOT" || mt3 == "WORKOUT_PAUSED" || mt3 == "WORKOUT_RESUMED") {
                        outbox.remove(k);
                        removed = true;
                        break;
                    }
                }
                if (!removed) {
                    outbox = outbox.slice(outbox.size() - MAX_OUTBOX, outbox.size());
                    break;
                }
            }
        }
        _saveOutbox(outbox);
        flushOutbox();
    }

    function flushOutbox() {
        if (_txInFlight) { return; }
        var nowMs = _timerNowMs();
        if (_txFailCount != null && _txFailCount instanceof Number && _txFailCount > 0) {
            var delay = TX_BACKOFF_BASE_MS;
            // Exponential: 15s -> 30s -> 60s -> 120s cap.
            for (var i = 1; i < _txFailCount; i += 1) {
                delay = delay * 2;
                if (delay >= TX_BACKOFF_MAX_MS) { delay = TX_BACKOFF_MAX_MS; break; }
            }
            var sinceFail = _timerDiffMs(_lastTxFailureAtMs, nowMs);
            if (sinceFail < delay) { return; }
        }
        var outbox = _loadOutbox();
        if (outbox.size() == 0) { return; }
        var first = outbox[0];
        if (first == null || !(first instanceof Dictionary)) { return; }
        _txInFlight = true;
        _lastFlushAttemptMs = nowMs;
        Communications.transmit(first, {}, new ZenithConnectionListener(self));
    }

    function _finishTransmit(success) {
        _txInFlight = false;
        if (!success) {
            _txFailCount = (_txFailCount == null || !(_txFailCount instanceof Number)) ? 1 : (_txFailCount + 1);
            _lastTxFailureAtMs = _timerNowMs();
            return;
        }
        _txFailCount = 0;
        _lastTxFailureAtMs = 0;
        Storage.setValue(KEY_LAST_DELIVERED_AT, Time.now().toString());
        var outbox = _loadOutbox();
        if (outbox.size() == 0) { return; }
        outbox.remove(0);
        _saveOutbox(outbox);
        // Continue draining.
        flushOutbox();
    }

    function _makeId(prefix) {
        var t = System.getTimer();
        var r = Math.rand();
        if (r < 0) { r = r * -1; }
        return prefix + "_" + t.toString() + "_" + r.toString();
    }
}

class ZenithConnectionListener extends Communications.ConnectionListener {
    var _store;

    function initialize(store) {
        ConnectionListener.initialize();
        _store = store;
    }

    function onComplete() {
        if (_store != null) { _store._finishTransmit(true); }
    }

    function onError() {
        if (_store != null) { _store._finishTransmit(false); }
    }
}
