using Toybox.Graphics;
using Toybox.Attention;
using Toybox.Lang;
using Toybox.Math;
using Toybox.System;
using Toybox.Timer;
using Toybox.WatchUi;

// Minimal P0 UI:
// - Home workout selector: 1 workout per screen (paged ViewLoop)
// - Live screen: elapsed + End (double-confirm)
// - Save/discard: explicit

function zenFmtTime(sec) {
    var s = sec % 60;
    var m = (sec / 60) % 60;
    var hh = sec / 3600;
    if (hh > 0) {
        return hh.format("%d") + ":" + m.format("%02d") + ":" + s.format("%02d");
    }
    return m.format("%02d") + ":" + s.format("%02d");
}

function zenVibrateFailure() {
    if (Attention has :vibrate) {
        Attention.vibrate([
            new Attention.VibeProfile(40, 120),
            new Attention.VibeProfile(40, 120)
        ]);
    }
}

function zenVibrateSuccess() {
    if (Attention has :vibrate) {
        Attention.vibrate([new Attention.VibeProfile(25, 100)]);
    }
}

function zenAccentColor() {
    if (Graphics has :createColor) {
        // Zenith brand accent: #00D9FF
        return Graphics.createColor(255, 0, 217, 255);
    }
    return Graphics.COLOR_BLUE;
}

function zenSafeInset(w, h) {
    var minDim = (w < h) ? w : h;
    var shape = System.getDeviceSettings().screenShape;

    var inset = 16;
    if (shape == System.SCREEN_SHAPE_ROUND) {
        // Inscribed-square safe inset for round screens.
        inset = Math.round(0.146 * minDim);
    } else if (shape == System.SCREEN_SHAPE_SEMI_ROUND || shape == System.SCREEN_SHAPE_SEMI_OCTAGON) {
        inset = Math.round(0.10 * minDim);
    } else {
        inset = 16;
    }

    if (inset < 10) { inset = 10; }
    // Clamp so tiny screens always have a drawable card.
    if (inset > (minDim / 3)) { inset = (minDim / 3); }
    return inset;
}

function zenSplitWords(text) {
    var t = text;
    if (t == null) { return []; }
    t = t.toString();

    var chars = t.toCharArray();
    var parts = [];
    var current = "";

    for (var i = 0; i < chars.size(); i += 1) {
        var c = chars[i].toString();
        if (c == " ") {
            if (current != "") {
                parts.add(current);
                current = "";
            }
        } else {
            current += c;
        }
    }
    if (current != "") {
        parts.add(current);
    }
    return parts;
}

function zenWrapTwoLines(dc, text, font, maxWidth) {
    var t = text;
    if (t == null) { return null; }
    t = t.toString();

    var parts = zenSplitWords(t);
    if (parts == null || parts.size() <= 1) {
        return null;
    }

    var best = null;
    for (var i = 1; i < parts.size(); i += 1) {
        var a = "";
        var b = "";
        for (var j = 0; j < i; j += 1) {
            if (j > 0) { a += " "; }
            a += parts[j];
        }
        for (var k = i; k < parts.size(); k += 1) {
            if (k > i) { b += " "; }
            b += parts[k];
        }
        var aw = dc.getTextWidthInPixels(a, font);
        var bw = dc.getTextWidthInPixels(b, font);
        if (aw <= maxWidth && bw <= maxWidth) {
            best = a + "\n" + b;
            break;
        }
    }
    return best;
}

function zenFitTitle(dc, title, maxWidth) {
    var fonts = [Graphics.FONT_LARGE, Graphics.FONT_MEDIUM, Graphics.FONT_SMALL];
    for (var i = 0; i < fonts.size(); i += 1) {
        var f = fonts[i];
        if (dc.getTextWidthInPixels(title, f) <= maxWidth) {
            return { :font => f, :text => title };
        }
    }
    for (var j = 0; j < fonts.size(); j += 1) {
        var f2 = fonts[j];
        var wrapped = zenWrapTwoLines(dc, title, f2, maxWidth);
        if (wrapped != null) {
            return { :font => f2, :text => wrapped };
        }
    }
    return { :font => Graphics.FONT_SMALL, :text => title };
}

function zenWorkoutConfigs() {
    return [
        { :id => :run_outdoor, :title => "Run", :kind => "run", :env => "outdoor" },
        { :id => :run_treadmill, :title => "Treadmill", :kind => "run", :env => "treadmill" },
        { :id => :lift, :title => "Lift", :kind => "lift", :env => "" }
    ];
}

function zenReturnToSelector(transition) {
    var t = transition;
    if (t == null) { t = WatchUi.SLIDE_DOWN; }
    var factory = new ZenithWorkoutSelectorFactory();
    var loop = new WatchUi.ViewLoop(factory, { :wrap => true, :color => zenAccentColor() });
    WatchUi.switchToView(loop, new ZenithWorkoutSelectorDelegate(loop), t);
}

class ZenithWorkoutSelectorFactory extends WatchUi.ViewLoopFactory {
    var _workouts;

    function initialize() {
        ViewLoopFactory.initialize();
        _workouts = zenWorkoutConfigs();
    }

    function getSize() {
        return _workouts.size();
    }

    function getView(page) {
        var workout = _workouts[page];
        // CIQ ViewLoopFactory.getView() expects an array; we provide a single view per page.
        return [ new ZenithWorkoutPageView(workout) ];
    }
}

class ZenithWorkoutSelectorDelegate extends WatchUi.ViewLoopDelegate {
    var _loop;
    var _workouts;
    var _page;

    function initialize(loop) {
        ViewLoopDelegate.initialize(loop);
        _loop = loop;
        _workouts = zenWorkoutConfigs();
        _page = 0;
    }

    function onNextView() {
        var ok = _loop.changeView(ViewLoop.DIRECTION_NEXT);
        if (ok && _workouts != null && _workouts.size() > 0) {
            _page = (_page + 1) % _workouts.size();
        }
        return ok;
    }

    function onPreviousView() {
        var ok = _loop.changeView(ViewLoop.DIRECTION_PREVIOUS);
        if (ok && _workouts != null && _workouts.size() > 0) {
            _page -= 1;
            if (_page < 0) { _page = _workouts.size() - 1; }
        }
        return ok;
    }

    function _startCurrent() {
        var workout = (_workouts != null && _workouts.size() > 0) ? _workouts[_page] : null;
        if (workout == null) { return true; }

        var kind = workout.get(:kind);
        var env = workout.get(:env);
        if (kind == null) { kind = ""; }
        if (env == null) { env = ""; }
        kind = kind.toString();
        env = env.toString();

        if (ZenithSession.start(kind, env)) {
            WatchUi.pushView(new ZenithLiveView(), new ZenithLiveDelegate(), WatchUi.SLIDE_UP);
        } else {
            zenVibrateFailure();
            WatchUi.pushView(new ZenithErrorView("Could not start workout"), new ZenithErrorDelegate(), WatchUi.SLIDE_UP);
        }
        return true;
    }

    function onSelect() {
        return _startCurrent();
    }

    function onTap(evt) {
        return _startCurrent();
    }

    function onMenu() {
        WatchUi.pushView(new ZenithStatusView(), new ZenithStatusDelegate(), WatchUi.SLIDE_UP);
        return true;
    }
}

class ZenithWorkoutPageView extends WatchUi.View {
    var _workout;

    function initialize(workout) {
        View.initialize();
        _workout = workout;
    }

    function onUpdate(dc) {
        var w = dc.getWidth();
        var h = dc.getHeight();

        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        var inset = zenSafeInset(w, h);
        var x = inset;
        var y = inset;
        var cw = w - (inset * 2);
        var ch = h - (inset * 2);

        var minDim = (cw < ch) ? cw : ch;
        var pad = Math.round(0.08 * minDim);
        if (pad < 12) { pad = 12; }
        if (pad > 22) { pad = 22; }

        var radius = Math.round(0.10 * minDim);
        if (radius < 16) { radius = 16; }
        if (radius > 28) { radius = 28; }

        var cardFill = (Graphics has :createColor) ? Graphics.createColor(255, 18, 18, 18) : Graphics.COLOR_DK_GRAY;
        var cardBorder = (Graphics has :createColor) ? Graphics.createColor(255, 255, 255, 255) : Graphics.COLOR_WHITE;
        var btnFill = zenAccentColor();
        var btnText = (Graphics has :createColor) ? Graphics.createColor(255, 6, 22, 28) : Graphics.COLOR_BLACK;

        dc.setColor(cardFill, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(x, y, cw, ch, radius);
        dc.setColor(cardBorder, Graphics.COLOR_TRANSPARENT);
        dc.drawRoundedRectangle(x, y, cw, ch, radius);

        var innerX = x + pad;
        var innerY = y + pad;
        var innerW = cw - (pad * 2);
        var innerH = ch - (pad * 2);

        var title = _workout.get(:title);
        if (title == null) { title = "Workout"; }
        title = title.toString();

        // Hint text is optional; if it doesn't fit, it will be omitted.
        var ds = System.getDeviceSettings();
        var hint = ds.isTouchScreen ? "Swipe up/down" : "Up/Down";
        var hintFont = Graphics.FONT_XTINY;
        var hintDims = dc.getTextDimensions(hint, hintFont);
        var hintH = hintDims[1];

        var btnH = (minDim <= 160) ? 34 : (minDim <= 200 ? 36 : 44);
        var btnW = innerW;
        var btnX = innerX;
        var btnY = innerY + innerH - btnH;

        // If we have room, draw hint above the button; otherwise skip.
        var hintY = btnY - hintH - 6;
        var hintOk = (hintY >= innerY + 4) && (hintDims[0] <= innerW);
        if (!hintOk) {
            hint = null;
            hintH = 0;
            hintY = btnY;
        }

        var titleAreaH = (hint != null) ? (hintY - innerY) : (btnY - innerY);
        if (titleAreaH < 10) { titleAreaH = 10; }

        var fit = zenFitTitle(dc, title, innerW);
        var titleText = fit.get(:text);
        var titleFont = fit.get(:font);
        var titleDims = dc.getTextDimensions(titleText, titleFont);
        var titleX = innerX + (innerW / 2);
        var titleY = innerY + (titleAreaH / 2) - (titleDims[1] / 2);
        if (titleY < innerY) { titleY = innerY; }

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(titleX, titleY, titleFont, titleText, Graphics.TEXT_JUSTIFY_CENTER);

        // Primary CTA (visual): large Start button. Selection still works from anywhere via tap/select.
        var btnRadius = Math.round(btnH / 2);
        dc.setColor(btnFill, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(btnX, btnY, btnW, btnH, btnRadius);

        var startLabel = "Start";
        var startFont = (minDim <= 160) ? Graphics.FONT_SMALL : Graphics.FONT_MEDIUM;
        var startDims = dc.getTextDimensions(startLabel, startFont);
        var startX = btnX + (btnW / 2);
        var startY = btnY + (btnH / 2) - (startDims[1] / 2);
        dc.setColor(btnText, Graphics.COLOR_TRANSPARENT);
        dc.drawText(startX, startY, startFont, startLabel, Graphics.TEXT_JUSTIFY_CENTER);

        if (hint != null) {
            dc.setColor((Graphics has :createColor) ? Graphics.createColor(255, 170, 170, 170) : Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(innerX + (innerW / 2), hintY, hintFont, hint, Graphics.TEXT_JUSTIFY_CENTER);
        }

        // P0: drain outbox even when no workout is active (prevents stuck summaries until next workout).
        ZenithSession.flushOutbox();
    }
}

class ZenithErrorView extends WatchUi.View {
    var _msg;

    function initialize(msg) {
        View.initialize();
        _msg = msg;
    }

    function onUpdate(dc) {
        dc.clear();
        var w = dc.getWidth();
        var h = dc.getHeight();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, (h / 2) - 22, Graphics.FONT_XTINY, _msg, Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(w / 2, (h / 2) + 2, Graphics.FONT_XTINY, "BACK to return", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(w / 2, (h / 2) + 18, Graphics.FONT_XTINY, "SELECT to reset", Graphics.TEXT_JUSTIFY_CENTER);
    }
}

class ZenithErrorDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onBack() {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }

    function onSelect() {
        // P0 escape hatch for save/discard failures or corrupted session handles.
        ZenithSession.forceClear("error_view");
        zenVibrateFailure();
        zenReturnToSelector(WatchUi.SLIDE_DOWN);
        return true;
    }
}

class ZenithLiveView extends WatchUi.View {
    var _timer;
    var _pausedRedrawTick;

    function initialize() {
        View.initialize();
        _timer = null;
        _pausedRedrawTick = 0;
    }

    function _mkColor(alpha, red, green, blue, fallback) {
        // CIQ 4+ supports full 0xAARRGGBB colors via createColor(). Fall back to system colors.
        if (Graphics has :createColor) {
            return Graphics.createColor(alpha, red, green, blue);
        }
        return fallback;
    }

    function _lerp(a, b, t) {
        return a + ((b - a) * t);
    }

    function _clamp255(v) {
        var n = v;
        if (n < 0) { n = 0; }
        if (n > 255) { n = 255; }
        return n;
    }

    function _bgTheme(kind, state) {
        // Returns [topColor, midColor, botColor] as AARRGGBB or system colors.
        var isLift = (kind == "lift");
        var isPaused = (state == "paused");
        var isEnding = ZenithSession.endIsArmed();
        if (isEnding) {
            // Hot warning theme
            return [
                _mkColor(255, 60, 10, 10, Graphics.COLOR_RED),
                _mkColor(255, 140, 40, 0, Graphics.COLOR_ORANGE),
                _mkColor(255, 10, 10, 18, Graphics.COLOR_BLACK),
            ];
        }
        if (isLift) {
            // Violet -> magenta -> deep navy
            var top = isPaused ? _mkColor(255, 64, 40, 110, Graphics.COLOR_PURPLE) : _mkColor(255, 112, 40, 210, Graphics.COLOR_PURPLE);
            var mid = isPaused ? _mkColor(255, 60, 30, 80, Graphics.COLOR_DK_GRAY) : _mkColor(255, 220, 80, 190, Graphics.COLOR_PURPLE);
            var bot = _mkColor(255, 10, 12, 20, Graphics.COLOR_BLACK);
            return [top, mid, bot];
        }
        // Run: teal -> blue -> deep navy
        var top2 = isPaused ? _mkColor(255, 0, 70, 90, Graphics.COLOR_BLUE) : _mkColor(255, 0, 190, 190, Graphics.COLOR_BLUE);
        var mid2 = isPaused ? _mkColor(255, 0, 55, 120, Graphics.COLOR_BLUE) : _mkColor(255, 30, 90, 255, Graphics.COLOR_BLUE);
        var bot2 = _mkColor(255, 10, 12, 20, Graphics.COLOR_BLACK);
        return [top2, mid2, bot2];
    }

    function _layoutProfile(w, h) {
        var minDim = (w < h) ? w : h;
        var isUltraCompact = (minDim <= 218);
        var isCompact = (minDim <= 240);
        var isLarge = (minDim >= 390);
        var inset = isUltraCompact ? 14 : (isCompact ? 12 : (isLarge ? 20 : 16));
        var titleY = isUltraCompact ? 16 : 20;
        var stateY = isUltraCompact ? 38 : 45;
        var timeLabelY = isUltraCompact ? (h / 2 - 56) : (isCompact ? (h / 2 - 60) : (h / 2 - 68));
        var timeY = isUltraCompact ? (h / 2 - 30) : (isCompact ? (h / 2 - 36) : (h / 2 - 40));
        var rowY = isUltraCompact ? (h / 2 + 8) : (isCompact ? (h / 2 + 12) : (h / 2 + 18));
        var detailY = isUltraCompact ? (rowY + 40) : (rowY + 48);
        var hintY = isUltraCompact ? (h - 40) : (h - 44);
        var endY = isUltraCompact ? (h - 22) : (h - 24);
        return {
            :isUltraCompact => isUltraCompact,
            :isCompact => isCompact,
            :isLarge => isLarge,
            :inset => inset,
            :titleY => titleY,
            :stateY => stateY,
            :timeLabelY => timeLabelY,
            :timeY => timeY,
            :rowY => rowY,
            :detailY => detailY,
            :hintY => hintY,
            :endY => endY
        };
    }

    function _drawGradientBg(dc, w, h, cTop, cMid, cBot) {
        // Approximate a gradient using horizontal bands (safe on all devices).
        var band = (w <= 240 || h <= 240) ? 8 : 10;
        var y = 0;
        while (y < h) {
            var denom = (h > 1) ? (h - 1).toFloat() : 1.0;
            var t = y.toFloat() / denom;
            if (t < 0) { t = 0; }
            if (t > 1) { t = 1; }
            // Blend top->mid for first half, mid->bot for second half.
            var c = cMid;
            if (Graphics has :createColor) {
                var r1 = 0; var g1 = 0; var b1 = 0;
                var r2 = 0; var g2 = 0; var b2 = 0;
                var r3 = 0; var g3 = 0; var b3 = 0;
                // Extract RGB from 0xAARRGGBB
                r1 = (cTop >> 16) & 0xFF; g1 = (cTop >> 8) & 0xFF; b1 = (cTop) & 0xFF;
                r2 = (cMid >> 16) & 0xFF; g2 = (cMid >> 8) & 0xFF; b2 = (cMid) & 0xFF;
                r3 = (cBot >> 16) & 0xFF; g3 = (cBot >> 8) & 0xFF; b3 = (cBot) & 0xFF;

                var rr = 0; var gg = 0; var bb = 0;
                if (t < 0.5) {
                    var tt = t / 0.5;
                    rr = _lerp(r1, r2, tt);
                    gg = _lerp(g1, g2, tt);
                    bb = _lerp(b1, b2, tt);
                } else {
                    var tt2 = (t - 0.5) / 0.5;
                    rr = _lerp(r2, r3, tt2);
                    gg = _lerp(g2, g3, tt2);
                    bb = _lerp(b2, b3, tt2);
                }
                c = Graphics.createColor(
                    255,
                    Math.round(_clamp255(rr)),
                    Math.round(_clamp255(gg)),
                    Math.round(_clamp255(bb))
                );
            } else {
                // No true color, just switch blocks.
                if (t < 0.35) { c = cTop; }
                else if (t < 0.70) { c = cMid; }
                else { c = cBot; }
            }

            dc.setColor(c, c);
            dc.fillRectangle(0, y, w, band);
            y += band;
        }

        // Soft highlight blobs (still just rectangles, but adds depth).
        var accentA = _mkColor(255, 255, 255, 255, Graphics.COLOR_WHITE);
        dc.setColor(accentA, accentA);
        dc.drawLine(0, 0, w, 0);
    }

    function onShow() as Void {
        _timer = new Timer.Timer();
        _timer.start(method(:_tick), 1000, true);
    }

    function onHide() as Void {
        if (_timer != null) {
            _timer.stop();
        }
        _timer = null;
    }

    function _tick() as Void {
        ZenithSession.tick();
        // Battery guard: paused sessions do not need full 1Hz redraws.
        var st = ZenithSession.getState();
        if (st == "paused") {
            _pausedRedrawTick += 1;
            if ((_pausedRedrawTick % 2) != 0) {
                return;
            }
        } else {
            _pausedRedrawTick = 0;
        }
        WatchUi.requestUpdate();
    }

    function onUpdate(dc) {
        dc.clear();
        var w = dc.getWidth();
        var h = dc.getHeight();

        var kind = ZenithSession.getKind();
        var state = ZenithSession.getState();
        var theme = _bgTheme(kind, state);
        _drawGradientBg(dc, w, h, theme[0], theme[1], theme[2]);
        var p = _layoutProfile(w, h);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w/2, p[:titleY], Graphics.FONT_XTINY, Rez.Strings.brand_live, Graphics.TEXT_JUSTIFY_CENTER);

        var label = (kind == "run") ? "RUN" : "LIFT";
        // Accent the state for clarity.
        var stateColor = (state == "paused") ? _mkColor(255, 255, 220, 140, Graphics.COLOR_YELLOW) : Graphics.COLOR_WHITE;
        if (ZenithSession.endIsArmed()) { stateColor = _mkColor(255, 255, 120, 120, Graphics.COLOR_RED); }
        dc.setColor(stateColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w/2, p[:stateY], Graphics.FONT_TINY, label + " · " + state.toUpper(), Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);

        // Time: show moving time prominently; total elapsed (including pause) is shown as a small footer line.
        var moving = ZenithSession.getMovingSec();
        var elapsed = ZenithSession.getElapsedSec();
        var compact = p[:isCompact];
        dc.drawText(w/2, p[:timeLabelY], Graphics.FONT_XTINY, "TIME", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(w/2, p[:timeY], compact ? Graphics.FONT_MEDIUM : Graphics.FONT_LARGE, zenFmtTime(moving), Graphics.TEXT_JUSTIFY_CENTER);

        // Metrics (best-effort). Layout is intentionally simple and within safe-ish bounds.
        var distM = ZenithSession.getDistanceMeters();
        var pace = ZenithSession.getPaceMinPerMile();
        var hr = ZenithSession.getHeartRateBpm();
        var cal = ZenithSession.getCalories();
        var setCount = ZenithSession.getSetCount();
        var liftBand = ZenithSession.getIntensityBand();

        var rowY = p[:rowY];
        var contentW = w - (p[:inset] * 2);
        var col = contentW / 3;
        var colX0 = p[:inset] + (col / 2);
        var colX1 = p[:inset] + col + (col / 2);
        var colX2 = p[:inset] + (2 * col) + (col / 2);

        if (kind == "lift") {
            dc.drawText(colX0, rowY, Graphics.FONT_XTINY, "SETS", Graphics.TEXT_JUSTIFY_CENTER);
            dc.drawText(colX0, rowY + 18, Graphics.FONT_SMALL, setCount.format("%d"), Graphics.TEXT_JUSTIFY_CENTER);

            dc.drawText(colX1, rowY, Graphics.FONT_XTINY, "CAL", Graphics.TEXT_JUSTIFY_CENTER);
            dc.drawText(colX1, rowY + 18, Graphics.FONT_SMALL, _fmtCal(cal), Graphics.TEXT_JUSTIFY_CENTER);

            dc.drawText(colX2, rowY, Graphics.FONT_XTINY, "HR", Graphics.TEXT_JUSTIFY_CENTER);
            dc.drawText(colX2, rowY + 18, Graphics.FONT_SMALL, _fmtHr(hr), Graphics.TEXT_JUSTIFY_CENTER);

            var undoHint = ZenithSession.setUndoIsArmed() ? (compact ? "SEL undo" : "SELECT to undo set") : (compact ? "SEL add" : "SELECT to add set");
            var liftDetail = compact ? ("INT " + liftBand.toUpper() + " · " + undoHint) : ("INTENSITY " + liftBand.toUpper() + " · " + undoHint);
            dc.drawText(w/2, p[:detailY], Graphics.FONT_XTINY, liftDetail, Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            dc.drawText(colX0, rowY, Graphics.FONT_XTINY, "DIST", Graphics.TEXT_JUSTIFY_CENTER);
            dc.drawText(colX0, rowY + 18, Graphics.FONT_SMALL, _fmtDist(distM), Graphics.TEXT_JUSTIFY_CENTER);

            var paceLabel = "PACE";
            if (ZenithSession.getPaceIsEstimated()) {
                paceLabel = compact ? "EST" : "EST PACE";
            }
            dc.drawText(colX1, rowY, Graphics.FONT_XTINY, paceLabel, Graphics.TEXT_JUSTIFY_CENTER);
            dc.drawText(colX1, rowY + 18, Graphics.FONT_SMALL, _fmtPace(pace), Graphics.TEXT_JUSTIFY_CENTER);

            dc.drawText(colX2, rowY, Graphics.FONT_XTINY, "HR", Graphics.TEXT_JUSTIFY_CENTER);
            dc.drawText(colX2, rowY + 18, Graphics.FONT_SMALL, _fmtHr(hr), Graphics.TEXT_JUSTIFY_CENTER);

            var runDetail = compact ? ("CAL " + _fmtCal(cal) + " · " + zenFmtTime(elapsed)) : ("CAL " + _fmtCal(cal) + " · ELAP " + zenFmtTime(elapsed));
            dc.drawText(w/2, p[:detailY], Graphics.FONT_XTINY, runDetail, Graphics.TEXT_JUSTIFY_CENTER);
        }

        // Controls hint
        var hint = "";
        if (ZenithSession.endIsArmed()) {
            hint = compact ? Rez.Strings.hint_confirm_end_compact : Rez.Strings.hint_confirm_end;
        } else if (kind == "lift") {
            hint = compact ? Rez.Strings.hint_lift_compact : Rez.Strings.hint_lift;
        } else {
            if (compact) {
                hint = (state == "paused") ? Rez.Strings.hint_run_paused_compact : Rez.Strings.hint_run_recording_compact;
            } else {
                hint = (state == "paused") ? Rez.Strings.hint_run_paused : Rez.Strings.hint_run_recording;
            }
        }
        dc.drawText(w/2, p[:hintY], Graphics.FONT_XTINY, hint, Graphics.TEXT_JUSTIFY_CENTER);
        // END label gets an accent stroke color when armed.
        var endColor = ZenithSession.endIsArmed() ? _mkColor(255, 255, 160, 160, Graphics.COLOR_RED) : _mkColor(255, 255, 255, 255, Graphics.COLOR_WHITE);
        dc.setColor(endColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w/2, p[:endY], compact ? Graphics.FONT_TINY : Graphics.FONT_SMALL, "BACK: " + Rez.Strings.end, Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
    }

    function _fmtDist(meters) {
        if (meters == null || meters != meters || meters < 0) { return "—"; }
        // Match common UX: show miles with 2 decimals, <0.1 show 0.00.
        var miles = meters / 1609.344;
        if (miles != miles || miles < 0 || miles > 1000) { return "—"; }
        return miles.format("%.2f") + "mi";
    }

    function _fmtPace(paceMinPerMile) {
        if (paceMinPerMile == null || paceMinPerMile != paceMinPerMile || paceMinPerMile <= 0) { return "—"; }
        var totalSecF = paceMinPerMile * 60.0;
        if (totalSecF != totalSecF || totalSecF <= 0 || totalSecF > 60 * 120) { return "—"; }
        var totalSec = Math.floor(totalSecF);
        if (totalSec <= 0) { return "—"; }
        var m = totalSec / 60;
        var s = totalSec % 60;
        return m.format("%d") + ":" + s.format("%02d");
    }

    function _fmtHr(bpm) {
        if (bpm == null || bpm != bpm || bpm <= 0) { return "—"; }
        return bpm.format("%d");
    }

    function _fmtCal(cal) {
        if (cal == null || cal != cal || cal < 0) { return "—"; }
        return cal.format("%d");
    }
}

class ZenithLiveDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onSelect() {
        var kind = ZenithSession.getKind();
        if (kind == "lift") {
            if (ZenithSession.setUndoIsArmed()) {
                ZenithSession.undoSet();
            } else {
                ZenithSession.addSet();
            }
            WatchUi.requestUpdate();
            return true;
        }

        // Run: Select toggles pause/resume (parity with Apple Watch).
        var st = ZenithSession.getState();
        if (st == "recording") {
            ZenithSession.pause();
            WatchUi.requestUpdate();
            return true;
        }
        if (st == "paused") {
            ZenithSession.resume();
            WatchUi.requestUpdate();
            return true;
        }
        return true;
    }

    function onBack() {
        // Back is the END confirm flow (double press).
        return _handleEnd();
    }

    function _handleEnd() {
        var st = ZenithSession.getState();
        if (st != "recording" && st != "paused") {
            return true;
        }
        if (!ZenithSession.endIsArmed()) {
            ZenithSession.armEnd();
            WatchUi.requestUpdate();
            return true;
        }
        ZenithSession.stop();
        WatchUi.pushView(new ZenithSaveView(), new ZenithSaveDelegate(), WatchUi.SLIDE_UP);
        return true;
    }
}

class ZenithSaveView extends WatchUi.View {
    function initialize() {
        View.initialize();
    }

    function onUpdate(dc) {
        dc.clear();
        var w = dc.getWidth();
        var h = dc.getHeight();
        var compact = (w <= 240 || h <= 240);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w/2, compact ? 24 : 28, Graphics.FONT_SMALL, Rez.Strings.save_title, Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(w/2, h/2 - (compact ? 6 : 10), compact ? Graphics.FONT_MEDIUM : Graphics.FONT_LARGE, zenFmtTime(ZenithSession.getMovingSec()), Graphics.TEXT_JUSTIFY_CENTER);
        if (ZenithSession.sessionRecovered()) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w/2, h/2 + (compact ? 12 : 16), Graphics.FONT_XTINY, "Recovered (partial)", Graphics.TEXT_JUSTIFY_CENTER);
        }
        dc.drawText(w/2, h - (compact ? 40 : 45), Graphics.FONT_TINY, Rez.Strings.save_primary, Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(w/2, h - (compact ? 22 : 25), Graphics.FONT_XTINY, compact ? Rez.Strings.save_secondary_compact : Rez.Strings.save_secondary, Graphics.TEXT_JUSTIFY_CENTER);
    }
}

class ZenithSaveDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onSelect() {
        var ok = ZenithSession.save();
        if (ok) {
            zenVibrateSuccess();
            zenReturnToSelector(WatchUi.SLIDE_DOWN);
        } else {
            zenVibrateFailure();
            WatchUi.pushView(new ZenithErrorView("Save failed"), new ZenithErrorDelegate(), WatchUi.SLIDE_UP);
        }
        return true;
    }

    function onBack() {
        var ok = ZenithSession.discard();
        if (ok) {
            zenVibrateSuccess();
            zenReturnToSelector(WatchUi.SLIDE_DOWN);
        } else {
            zenVibrateFailure();
            WatchUi.pushView(new ZenithErrorView("Discard failed"), new ZenithErrorDelegate(), WatchUi.SLIDE_UP);
        }
        return true;
    }
}

class ZenithStatusView extends WatchUi.View {
    function initialize() {
        View.initialize();
    }

    function onUpdate(dc) {
        dc.clear();
        var w = dc.getWidth();
        var h = dc.getHeight();
        var compact = (w <= 240 || h <= 240);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w/2, compact ? 20 : 24, Graphics.FONT_SMALL, Rez.Strings.status_title, Graphics.TEXT_JUSTIFY_CENTER);

        var last = ZenithSession.lastDeliveredAt();
        var line1 = (last == "") ? Rez.Strings.status_empty : Rez.Strings.status_last_label;
        dc.drawText(w/2, h/2 - (compact ? 16 : 20), Graphics.FONT_XTINY, line1, Graphics.TEXT_JUSTIFY_CENTER);
        if (last != "") {
            dc.drawText(w/2, h/2 + (compact ? -2 : 0), Graphics.FONT_XTINY, last, Graphics.TEXT_JUSTIFY_CENTER);
        }
        dc.drawText(w/2, h - (compact ? 16 : 20), Graphics.FONT_XTINY, Rez.Strings.status_back, Graphics.TEXT_JUSTIFY_CENTER);
    }
}

class ZenithStatusDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onBack() {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }
}
