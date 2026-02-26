import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const DEFAULT_THRESHOLD = 30;   // pixels of accumulated movement before d-pad fire
const COOLDOWN_MS       = 120;  // minimum ms between d-pad fires
const SCROLL_COOLDOWN_MS = 300; // minimum ms between volume commands
const FEEDBACK_MS       = 200;  // ms to highlight active control in info panel

// ── MouseInfoPanel ────────────────────────────────────────────────────────────
// Floating overlay panel showing the control map and sensitivity slider.
// Uses Clutter.FixedLayout with manual absolute positioning throughout.
const MouseInfoPanel = GObject.registerClass(
class MouseInfoPanel extends St.Widget {
    _init() {
        super._init({
            style_class: 'appletv-mouse-panel',
            layout_manager: new Clutter.FixedLayout(),
            reactive: false,
            width: 240,
            height: 330,
        });

        this._threshold = DEFAULT_THRESHOLD;
        this._feedbackTimers = {};  // control name → timer id
        this._controlWidgets = {}; // control name → St.Widget

        this._buildUI();
    }

    _buildUI() {
        const W = 240;

        // ── Title row ────────────────────────────────────────────────────────
        const title = new St.Label({
            style_class: 'appletv-mouse-title',
            text: '🖱  Mouse Control',
        });
        title.set_position(8, 6);
        this.add_child(title);

        // ── Status row ───────────────────────────────────────────────────────
        const status = new St.Label({
            style_class: 'appletv-mouse-status',
            text: '● Captured — right click to release',
        });
        status.set_position(8, 30);
        this.add_child(status);

        // ── Separator ────────────────────────────────────────────────────────
        const sep1 = new St.Widget({ style_class: 'appletv-mouse-sep', width: W - 16, height: 1 });
        sep1.set_position(8, 52);
        this.add_child(sep1);

        // ── Mouse button map ─────────────────────────────────────────────────
        // Left button (Select)
        const btnLeft = this._makeMapBox('btn_left', 'LEFT CLICK\nSelect', 8, 58, 105, 40);
        // Right button (Release)
        const btnRight = this._makeMapBox('btn_right', 'RIGHT CLICK\nRelease', 127, 58, 105, 40);
        // Scroll wheel
        const btnScroll = this._makeMapBox('btn_scroll', '↑ SCROLL WHEEL ↓\nVolume + / −', 8, 102, 224, 30);
        // Body / move
        const btnMove = this._makeMapBox('btn_move', 'MOUSE MOVEMENT → D-PAD', 8, 136, 224, 26);

        [btnLeft, btnRight, btnScroll, btnMove].forEach(b => this.add_child(b));

        // ── Separator ────────────────────────────────────────────────────────
        const sep2 = new St.Widget({ style_class: 'appletv-mouse-sep', width: W - 16, height: 1 });
        sep2.set_position(8, 167);
        this.add_child(sep2);

        // ── D-pad visualizer label ────────────────────────────────────────────
        const dpadLabel = new St.Label({
            style_class: 'appletv-mouse-status',
            text: 'Last Direction',
        });
        dpadLabel.set_position(8, 173);
        this.add_child(dpadLabel);

        // ── D-pad visualizer (5 cells in + shape, each 28×28, 4px gap) ───────
        // Center of d-pad area: x=120, y=216
        const cx = 120, cy = 216, cs = 28, gap = 4;
        const step = cs + gap;

        const dpadUp    = this._makeDpadCell('dpad_up',    '▲', cx - cs/2,        cy - step);
        const dpadLeft  = this._makeDpadCell('dpad_left',  '◀', cx - step - cs/2, cy - cs/2);
        const dpadCtr   = this._makeDpadCell('dpad_center','●', cx - cs/2,        cy - cs/2);
        const dpadRight = this._makeDpadCell('dpad_right', '▶', cx + step - cs/2, cy - cs/2);
        const dpadDown  = this._makeDpadCell('dpad_down',  '▼', cx - cs/2,        cy + step - cs/2);

        [dpadUp, dpadLeft, dpadCtr, dpadRight, dpadDown].forEach(c => this.add_child(c));

        // ── Separator ────────────────────────────────────────────────────────
        const sep3 = new St.Widget({ style_class: 'appletv-mouse-sep', width: W - 16, height: 1 });
        sep3.set_position(8, 253);
        this.add_child(sep3);

        // ── Sensitivity row ───────────────────────────────────────────────────
        const sensLabel = new St.Label({
            style_class: 'appletv-mouse-status',
            text: 'Sensitivity:',
        });
        sensLabel.set_position(8, 260);
        this.add_child(sensLabel);

        const btnMinus = new St.Button({
            style_class: 'appletv-mouse-threshold-btn',
            label: '−',
            reactive: true,
            width: 24,
            height: 24,
        });
        btnMinus.set_position(90, 257);
        this.add_child(btnMinus);

        this._thresholdLabel = new St.Label({
            style_class: 'appletv-mouse-threshold-val',
            text: `${this._threshold}px`,
        });
        this._thresholdLabel.set_position(118, 260);
        this.add_child(this._thresholdLabel);

        const btnPlus = new St.Button({
            style_class: 'appletv-mouse-threshold-btn',
            label: '+',
            reactive: true,
            width: 24,
            height: 24,
        });
        btnPlus.set_position(172, 257);
        this.add_child(btnPlus);

        btnMinus.connect('button-press-event', () => {
            this._threshold = Math.max(10, this._threshold - 5);
            this._thresholdLabel.set_text(`${this._threshold}px`);
            return Clutter.EVENT_STOP;
        });
        btnPlus.connect('button-press-event', () => {
            this._threshold = Math.min(120, this._threshold + 5);
            this._thresholdLabel.set_text(`${this._threshold}px`);
            return Clutter.EVENT_STOP;
        });

        // ── Separator ────────────────────────────────────────────────────────
        const sep4 = new St.Widget({ style_class: 'appletv-mouse-sep', width: W - 16, height: 1 });
        sep4.set_position(8, 287);
        this.add_child(sep4);

        // ── Tips row ──────────────────────────────────────────────────────────
        const tips = new St.Label({
            style_class: 'appletv-mouse-tips',
            text: 'Move=D-Pad  Left=Select  Scroll=Vol  Right/Esc=Exit',
        });
        tips.set_position(8, 294);
        tips.clutter_text.set_line_wrap(true);
        tips.clutter_text.set_ellipsize(0);
        this.add_child(tips);
    }

    // Create a labeled map box (non-reactive label area)
    _makeMapBox(name, labelText, x, y, w, h) {
        const cssMap = {
            btn_left:   'appletv-mouse-btn-left',
            btn_right:  'appletv-mouse-btn-right',
            btn_scroll: 'appletv-mouse-btn-scroll',
            btn_move:   'appletv-mouse-btn-move',
        };
        const box = new St.Widget({
            style_class: cssMap[name] || 'appletv-mouse-btn-move',
            width: w,
            height: h,
            layout_manager: new Clutter.FixedLayout(),
        });
        box.set_position(x, y);

        const lbl = new St.Label({
            text: labelText,
            style_class: 'appletv-mouse-map-label',
            x_align: Clutter.ActorAlign.CENTER,
        });
        lbl.set_position(0, h / 2 - 8);
        lbl.set_width(w);
        lbl.clutter_text.set_line_wrap(true);
        lbl.clutter_text.set_ellipsize(0);
        box.add_child(lbl);

        this._controlWidgets[name] = box;
        return box;
    }

    // Create a d-pad cell
    _makeDpadCell(name, char, x, y) {
        const isCenter = name === 'dpad_center';
        const cell = new St.Label({
            style_class: isCenter ? 'appletv-mouse-dpad-center' : 'appletv-mouse-dpad-cell',
            text: char,
            width: 28,
            height: 28,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        cell.set_position(x, y);
        this._controlWidgets[name] = cell;
        return cell;
    }

    // Briefly highlight a named control widget
    setActiveControl(name) {
        const widget = this._controlWidgets[name];
        if (!widget) return;

        // Cancel any pending clear for this control
        if (this._feedbackTimers[name]) {
            GLib.source_remove(this._feedbackTimers[name]);
            this._feedbackTimers[name] = null;
        }

        widget.add_style_class_name('appletv-mouse-active');

        this._feedbackTimers[name] = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FEEDBACK_MS, () => {
            widget.remove_style_class_name('appletv-mouse-active');
            this._feedbackTimers[name] = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    getThreshold() {
        return this._threshold;
    }

    destroy() {
        // Clear all pending feedback timers
        for (const id of Object.values(this._feedbackTimers)) {
            if (id) GLib.source_remove(id);
        }
        this._feedbackTimers = {};
        super.destroy();
    }
});

// ── MouseControlOverlay ───────────────────────────────────────────────────────
// Full-screen transparent reactive layer that captures all input during mouse
// control mode. Added to Main.uiGroup so it sits above everything.
const MouseControlOverlay = GObject.registerClass(
class MouseControlOverlay extends St.Widget {
    _init(onExit) {
        super._init({
            layout_manager: new Clutter.FixedLayout(),
            reactive: true,
        });

        this._onExit = onExit;

        // Size to primary monitor
        const monitor = Main.layoutManager.primaryMonitor;
        this.set_size(monitor.width, monitor.height);
        this.set_position(0, 0);

        // Motion accumulator state
        this._lastX = null;
        this._lastY = null;
        this._accX = 0;
        this._accY = 0;
        this._lastFireTime = 0;
        this._lastScrollTime = 0;

        // Info panel — positioned at top-right with some margin
        this._infoPanel = new MouseInfoPanel();
        const panelX = monitor.width - 240 - 16;
        const panelY = 48;
        this._infoPanel.set_position(panelX, panelY);
        this.add_child(this._infoPanel);

        // Wire up events
        this.connect('motion-event',       this._onMotion.bind(this));
        this.connect('button-press-event', this._onButtonPress.bind(this));
        this.connect('scroll-event',       this._onScroll.bind(this));
        this.connect('key-press-event',    this._onKey.bind(this));

        // Grab keyboard focus so Escape works
        this.grab_key_focus();
    }

    _getMainExt() {
        return Extension.lookupByUUID('appletv-remote@local');
    }

    _sendCmd(cmd) {
        const main = this._getMainExt();
        if (!main) {
            log('AppleTV-Mouse: main extension not available');
            return;
        }
        const deviceId = main.getSelectedDevice();
        if (!deviceId) {
            log('AppleTV-Mouse: no device selected');
            return;
        }
        main.sendCommand(cmd, deviceId).catch(e => {
            log(`AppleTV-Mouse: command ${cmd} failed: ${e}`);
        });
    }

    _onMotion(actor, event) {
        const [x, y] = event.get_coords();

        // Establish reference on first event
        if (this._lastX === null) {
            this._lastX = x;
            this._lastY = y;
            return Clutter.EVENT_STOP;
        }

        this._accX += x - this._lastX;
        this._accY += y - this._lastY;
        this._lastX = x;
        this._lastY = y;

        const threshold = this._infoPanel.getThreshold();
        const now = GLib.get_monotonic_time() / 1000; // µs → ms

        if (Math.abs(this._accX) >= threshold || Math.abs(this._accY) >= threshold) {
            if (now - this._lastFireTime < COOLDOWN_MS) {
                // Still in cooldown — discard excess to prevent burst when cooldown clears
                if (Math.abs(this._accX) > threshold * 3 || Math.abs(this._accY) > threshold * 3) {
                    this._accX = 0;
                    this._accY = 0;
                }
                return Clutter.EVENT_STOP;
            }

            let cmd;
            if (Math.abs(this._accX) >= Math.abs(this._accY)) {
                cmd = this._accX > 0 ? 'right' : 'left';
            } else {
                cmd = this._accY > 0 ? 'down' : 'up';
            }

            this._sendCmd(cmd);
            this._infoPanel.setActiveControl('dpad_' + cmd);
            this._accX = 0;
            this._accY = 0;
            this._lastFireTime = now;
        }

        return Clutter.EVENT_STOP;
    }

    _onButtonPress(actor, event) {
        const button = event.get_button();
        if (button === 1) {
            // Primary click → Select
            this._sendCmd('select');
            this._infoPanel.setActiveControl('dpad_center');
            this._infoPanel.setActiveControl('btn_left');
        } else if (button === 3) {
            // Secondary click → exit capture
            this._infoPanel.setActiveControl('btn_right');
            this._onExit();
        }
        return Clutter.EVENT_STOP;
    }

    _onScroll(actor, event) {
        const now = GLib.get_monotonic_time() / 1000;
        if (now - this._lastScrollTime < SCROLL_COOLDOWN_MS) {
            return Clutter.EVENT_STOP;
        }
        this._lastScrollTime = now;

        const direction = event.get_scroll_direction();
        if (direction === Clutter.ScrollDirection.UP) {
            this._sendCmd('volume_up');
            this._infoPanel.setActiveControl('btn_scroll');
        } else if (direction === Clutter.ScrollDirection.DOWN) {
            this._sendCmd('volume_down');
            this._infoPanel.setActiveControl('btn_scroll');
        }
        return Clutter.EVENT_STOP;
    }

    _onKey(actor, event) {
        if (event.get_key_symbol() === Clutter.KEY_Escape) {
            this._onExit();
        }
        return Clutter.EVENT_STOP;
    }
});

// ── MouseIndicator ─────────────────────────────────────────────────────────────
// Panel button that toggles mouse capture mode.
const MouseIndicator = GObject.registerClass(
class MouseIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Apple TV Mouse Control', true); // dontCreateMenu=true

        this._icon = new St.Icon({
            icon_name: 'input-mouse-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        this._captured = false;
        this._overlay = null;

        this.connect('button-press-event', this._onClicked.bind(this));
    }

    _onClicked() {
        if (this._captured) {
            this._exitCapture();
        } else {
            this._enterCapture();
        }
        return Clutter.EVENT_STOP;
    }

    _enterCapture() {
        this._overlay = new MouseControlOverlay(() => this._exitCapture());
        Main.uiGroup.add_child(this._overlay);
        this._captured = true;
        // Visual indicator: tint the icon green
        this._icon.set_style('color: #00ff66;');
    }

    _exitCapture() {
        if (this._overlay) {
            this._overlay.destroy();
            this._overlay = null;
        }
        this._captured = false;
        this._icon.set_style('');
    }

    destroy() {
        this._exitCapture();
        super.destroy();
    }
});

// ── Extension ─────────────────────────────────────────────────────────────────
export default class MouseControlExtension extends Extension {
    enable() {
        this._indicator = new MouseIndicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
