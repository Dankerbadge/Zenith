using Toybox.Application;
using Toybox.WatchUi;

class ZenithApp extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
        ZenithSession.init();
    }

    function onStart(state) {
        // Ensure inbound command channel + outbox draining are active even when idle.
        ZenithSession.onAppStart();
    }

    function onStop(state) {
        // No-op: session persists via Storage in SessionStore.
    }

    function getInitialView() {
        var factory = new ZenithWorkoutSelectorFactory();
        var loop = new WatchUi.ViewLoop(factory, { :wrap => true, :color => zenAccentColor() });
        return [ loop, new ZenithWorkoutSelectorDelegate(loop) ];
    }
}
