// Global singleton wrapper for SessionStore so Views can call it easily.
// Using a module keeps call sites simple (`ZenithSession.start(...)`) and avoids
// static-method quirks.

module ZenithSession {
    var _store;

    function init() {
        if (_store == null) {
            _store = new SessionStore();
        }
    }

    function _s() {
        init();
        return _store;
    }

    function getState() { return (_s() != null) ? _s().getState() : "idle"; }
    function getKind() { return (_s() != null) ? _s().getKind() : ""; }
    function getRunEnvironment() { return (_s() != null) ? _s().getRunEnvironment() : ""; }
    function getSessionId() { return (_s() != null) ? _s().getSessionId() : ""; }
    function sessionRecovered() { return (_s() != null) ? _s().getSessionRecovered() : false; }
    // Total elapsed time in seconds since start, including pauses.
    function getElapsedSec() { return (_s() != null) ? _s().getElapsedSec() : 0; }
    // Moving/active time in seconds (elapsed - paused).
    function getMovingSec() { return (_s() != null) ? _s().getMovingSec() : 0; }
    function getPausedSec() { return (_s() != null) ? _s().getPausedSec() : 0; }
    function getEndTimestamp() { return (_s() != null) ? _s().getEndTimestamp() : ""; }
    function tick() { if (_s() != null) { _s().tick(); } }
    function onAppStart() { if (_s() != null) { _s().onAppStart(); } }
    function flushOutbox() { if (_s() != null) { _s().flushOutbox(); } }
    function forceClear(reason) { if (_s() != null) { _s().forceClear(reason); } }

    function start(kind, runEnvironment) { return (_s() != null) ? _s().start(kind, runEnvironment) : false; }
    function pause() { if (_s() != null) { _s().pause(); } }
    function resume() { if (_s() != null) { _s().resume(); } }
    function stop() { if (_s() != null) { _s().stop(); } }
    function save() { return (_s() != null) ? _s().save() : false; }
    function discard() { return (_s() != null) ? _s().discard() : false; }

    // Live metrics (best-effort; may return null / 0 depending on device capabilities).
    function getDistanceMeters() { return (_s() != null) ? _s().getDistanceMeters() : null; }
    function getPaceMinPerMile() { return (_s() != null) ? _s().getPaceMinPerMile() : null; }
    function getPaceIsEstimated() { return (_s() != null) ? _s().getPaceIsEstimated() : false; }
    function getHeartRateBpm() { return (_s() != null) ? _s().getHeartRateBpm() : null; }
    function getAvgHeartRateBpm() { return (_s() != null) ? _s().getAvgHeartRateBpm() : null; }
    function getMaxHeartRateBpm() { return (_s() != null) ? _s().getMaxHeartRateBpm() : null; }
    function getCalories() { return (_s() != null) ? _s().getCalories() : null; }
    function getSetCount() { return (_s() != null) ? _s().getSetCount() : 0; }
    function getIntensityBand() { return (_s() != null) ? _s().getIntensityBand() : "low"; }
    function setUndoIsArmed() { return (_s() != null) ? _s().setUndoIsArmed() : false; }

    function armEnd() { if (_s() != null) { _s().armEnd(); } }
    function endIsArmed() { return (_s() != null) ? _s().endIsArmed() : false; }

    function addSet() { if (_s() != null) { _s().addSet(); } }
    function undoSet() { if (_s() != null) { _s().undoSet(); } }

    function lastDeliveredAt() { return (_s() != null) ? _s().lastDeliveredAt() : ""; }
}
