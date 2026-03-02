
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import { AppDialog } from './appDialog.js';
import { DeviceDialog } from './deviceDialog.js';

// App button layout inside the remote widget.
// Lowest hitbox bottom: y=566 (volume_down at y=483, h=83). App buttons start 12px below.
const APP_BTNS_Y = 578;
// 3 columns centered: 6px gaps, total content 162px, centered in 225px remote
const APP_BTN_COLS = [32, 88, 144];
const APP_BTN_W = 50;
const APP_BTN_H = 50;
const APP_BTN_ROW_H = APP_BTN_H + 6; // row height including 6px gap

const DEFAULT_FAVORITE_APPS = [
    { id: 'com.apple.TVWatchList',  name: 'TV' },
    { id: 'com.apple.TVMusic',      name: 'Music' },
    { id: 'com.apple.TVSettings',   name: 'Settings' },
];

// CSS class to apply for each known app's brand color (defined in stylesheet.css)
const APP_COLOR_CLASSES = {
    'com.apple.TVWatchList':   'fruittv-app-color-tv',
    'com.apple.TVMusic':       'fruittv-app-color-music',
    'com.apple.TVSettings':    'fruittv-app-color-settings',
    'com.google.ios.youtube':  'fruittv-app-color-youtube',
    'com.netflix.Netflix':     'fruittv-app-color-netflix',
    'com.hulu.HuluTV':         'fruittv-app-color-hulu',
};

// The app ID for the TV app — gets special fruit+TV rendering
const TV_APP_ID = 'com.apple.TVWatchList';


const FruitTVIndicator = GObject.registerClass(
class FruitTVIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Fruit TV Remote', false);
        this._extension = extension;

        // Load panel icon from the selected logo fruit SVG
        const fruit = this._extension.getLogoFruit();
        const iconFile = Gio.File.new_for_path(`${this._extension.path}/icons/fruits/${fruit}-symbolic.svg`);
        this._panelIcon = new St.Icon({
            gicon: new Gio.FileIcon({ file: iconFile }),
            style_class: 'system-status-icon',
        });
        this.add_child(this._panelIcon);

        this._powerStates = new Map();
        this._devices = new Map();

        // Pre-populate selected device from config so we can preconnect on first open
        this._selectedId = null;
        try {
            const cfgPath = `${GLib.get_home_dir()}/.config/appletv-remote/devices.json`;
            const [ok, bytes] = GLib.file_get_contents(cfgPath);
            if (ok) {
                const cfg = JSON.parse(new TextDecoder().decode(bytes));
                if (cfg.selected) this._selectedId = cfg.selected;
            }
        } catch (_e) {}

        this._pollTimer = null;
        this._lastTitle = null;

        // Issue 6: currently active app id (from metadata polling)
        this._currentAppId = null;

        // App button references inside the remote widget (for refresh and active-border)
        this._remoteWidget = null;
        this._appBtnWidgets = [];
        this._appBtnMap = new Map();

        // Persistent daemon state
        this._daemon = null;
        this._daemonStdin = null;
        this._daemonStdout = null;
        this._pendingRequests = new Map();
        this._cmdId = 0;

        this._buildMenu();
        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen) {
                this._loadDevices();
                this._refreshAppButtons();
            } else {
                this._stopPolling();
            }
        });
    }

    // Update the logo fruit: save setting, update panel icon, refresh TV app button
    _setLogoFruit(fruitId) {
        this._extension._saveLogoFruit(fruitId);
        const iconFile = Gio.File.new_for_path(
            `${this._extension.path}/icons/fruits/${fruitId}-symbolic.svg`
        );
        this._panelIcon.set_gicon(new Gio.FileIcon({ file: iconFile }));
        this._refreshAppButtons();
    }

    _buildMenu() {
        this.menu.removeAll();

        // --- Remote graphic with overlaid hit regions and app buttons ---
        this._remoteControls();

        // --- Text Input ---
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const textEntry = new St.Entry({
            hint_text: _('Type and press Enter...'),
            can_focus: true,
            style_class: 'fruittv-text-entry',
        });
        const textEntryItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        textEntryItem.add_child(textEntry);
        this.menu.addMenuItem(textEntryItem);
        textEntry.clutter_text.connect('activate', () => {
            const text = textEntry.get_text();
            if (text) {
                this._send('keyboard_set', this._selectedId, text);
                textEntry.set_text('');
            }
        });
    }

    _remoteControls() {
        // Both atv_remote.png and atv_remote_hitboxes.png are 225×877.
        // Use natural image dimensions so hit-region coordinates map 1:1.
        const remoteWidth  = 225;
        const remoteHeight = 877;

        const remote = new St.Widget({
            style_class: 'fruittv-remote-graphic',
            layout_manager: new Clutter.FixedLayout(),
            reactive: false,
        });
        remote.set_size(remoteWidth, remoteHeight);
        remote.set_style(
            `background-image: url("${this._extension.path}/atv_remote.png"); ` +
            'background-size: 100% 100%; background-repeat: no-repeat;'
        );
        this._remoteWidget = remote;

        log(`FruitTV-Remote: loading remote graphic ${this._extension.path}/atv_remote.png`);

        const addHit = (command, x, y, w, h, className = '') => {
            const btn = new St.Button({
                style_class: `fruittv-hit-btn${className ? ` ${className}` : ''}`,
                can_focus: true,
            });
            remote.add_child(btn);
            // Coordinates from the 225×877 hitboxes PNG — no scaling needed.
            btn.set_position(x, y);
            btn.set_size(w, h);
            if (typeof command === 'function') {
                btn.connect('button-press-event', () => {
                    command();
                    return Clutter.EVENT_STOP;
                });
            } else if (typeof command === 'object' && command.press) {
                btn.connect('button-press-event', () => {
                    command.press();
                    return Clutter.EVENT_STOP;
                });
                if (command.release) {
                    btn.connect('button-release-event', () => {
                        command.release();
                        return Clutter.EVENT_STOP;
                    });
                }
            } else if (command) {
                btn.connect('button-press-event', () => {
                    this._send(command, this._selectedId);
                    return Clutter.EVENT_STOP;
                });
            }
        };

        const light = new St.Widget({
            style_class: 'fruittv-remote-light',
            reactive: false,
        });
        remote.add_child(light);
        light.set_position(104, 45);
        light.set_size(16, 7);
        this._remoteLight = light;
        this._setRemoteReady(false);

        // Long press for select button
        this._selectTimer = null;
        let selectLongPressed = false;
        const selectCmd = {
            press: () => {
                selectLongPressed = false;
                this._selectTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                    this._selectTimer = null;
                    selectLongPressed = true;
                    this._send('select_hold', this._selectedId);
                    return GLib.SOURCE_REMOVE;
                });
            },
            release: () => {
                if (this._selectTimer) {
                    GLib.source_remove(this._selectTimer);
                    this._selectTimer = null;
                }
                if (!selectLongPressed) {
                    this._send('select', this._selectedId);
                }
            }
        };

        // Hit regions from atv_remote_hitboxes.png (225×877).
        // Mid-green (0,128,0) top-left → device manager.
        // Azure (0,127,255) left edge → skip_prev; Bone (227,218,201) right edge → skip_next.
        const regions = [
            { command: () => this._openDeviceDialog(), x: 0,   y: 0,   w: 92,  h: 92 },
            { command: () => this._togglePower(),       x: 133, y: 0,   w: 92,  h: 92 },

            { command: 'up',        x: 42,  y: 78,  w: 143, h: 64 },
            { command: 'left',      x: 5,   y: 115, w: 65,  h: 144 },
            { command: selectCmd,   x: 56,  y: 130, w: 114, h: 111, className: 'fruittv-hit-circle' },
            { command: 'right',     x: 157, y: 114, w: 67,  h: 144 },
            { command: 'down',      x: 43,  y: 230, w: 144, h: 66 },

            { command: 'skip_prev', x: 0,   y: 244, w: 51,  h: 57 },
            { command: 'skip_next', x: 174, y: 244, w: 51,  h: 57 },

            { command: 'menu',        x: 21,  y: 291, w: 85, h: 85 },
            { command: 'home',        x: 118, y: 293, w: 83, h: 83 },

            { command: 'play_pause',  x: 22,  y: 387, w: 83, h: 83 },
            { command: 'volume_up',   x: 119, y: 386, w: 83, h: 83 },
            { command: () => this._openAppSelector(), x: 21, y: 482, w: 83, h: 83 },
            { command: 'volume_down', x: 120, y: 483, w: 83, h: 83 },
        ];

        for (const region of regions) {
            addHit(region.command, region.x, region.y, region.w, region.h, region.className || '');
        }

        const bin = new St.Bin({ child: remote, x_align: Clutter.ActorAlign.CENTER });
        const item = new PopupMenu.PopupBaseMenuItem({ reactive: false, style_class: 'fruittv-remote-item' });
        item.add_child(bin);
        this.menu.addMenuItem(item);
    }

    // ── App quick-launch buttons (overlaid inside remote widget) ──

    _refreshAppButtons() {
        if (!this._remoteWidget) return;

        // Remove old app buttons from the remote widget
        for (const w of this._appBtnWidgets) {
            w.destroy();
        }
        this._appBtnWidgets = [];
        this._appBtnMap.clear();

        const favorites = this._extension.getFavoriteAppObjects();
        if (favorites.length === 0) return;

        for (let i = 0; i < favorites.length; i++) {
            const col = i % APP_BTN_COLS.length;
            const row = Math.floor(i / APP_BTN_COLS.length);
            const x = APP_BTN_COLS[col];
            const y = APP_BTNS_Y + row * APP_BTN_ROW_H;

            const btn = this._makeQuickAppButton(favorites[i]);
            this._remoteWidget.add_child(btn);
            btn.set_position(x, y);
            btn.set_size(APP_BTN_W, APP_BTN_H);
            this._appBtnWidgets.push(btn);
            this._appBtnMap.set(favorites[i].id, btn);
        }

        // Re-apply active border for the currently playing app
        this._updateActiveAppBorder(this._currentAppId);
    }

    _makeQuickAppButton(app) {
        // TV app gets special fruit + "TV" rendering
        if (app.id === TV_APP_ID)
            return this._makeFruitTVButton(app);

        const iconFile = this._extension.getAppIconSync(app);
        const fetchedColors = this._extension.getAppColor(app.id);
        const isLoading = !iconFile && !this._extension.hasAppBeenProcessed(app.id);

        // Priority: fetched colors > CSS brand class (only when no icon, not loading, no fetched colors)
        const colorClass = (!iconFile && !fetchedColors && !isLoading) ? (APP_COLOR_CLASSES[app.id] || null) : null;
        const styleClasses = ['fruittv-quick-app-btn', ...(colorClass ? [colorClass] : [])].join(' ');

        const btn = new St.Button({
            style_class: styleClasses,
            can_focus: true,
        });

        if (iconFile) {
            // Real icon fills the whole button — no label
            btn.add_style_class_name('fruittv-quick-app-btn-with-icon');
            btn.set_style(
                `background-image: url("${iconFile.get_path()}"); ` +
                `background-size: ${APP_BTN_W}px ${APP_BTN_H}px; ` +
                'background-position: center; background-repeat: no-repeat;'
            );
        } else if (isLoading) {
            // Loading state: black background with centered white app name
            const loadingPath = `${this._extension.path}/icons/apps/loading.png`;
            btn.set_style(
                `background-image: url("${loadingPath}"); ` +
                'background-size: 100% 100%; background-repeat: no-repeat;'
            );
            btn.set_child(new St.Label({
                text: app.name,
                style_class: 'fruittv-quick-app-label',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            }));
        } else {
            // Color fallback — centered label
            if (fetchedColors) {
                btn.set_style(`background-color: ${fetchedColors.bg};`);
            }
            const label = new St.Label({
                text: app.name,
                style_class: 'fruittv-quick-app-label',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            if (fetchedColors) {
                label.set_style(`color: ${fetchedColors.text};`);
            }
            btn.set_child(label);
        }

        btn.connect('button-press-event', () => {
            if (this._selectedId) {
                log(`[FruitTV] Quick-launching app ${app.name} (${app.id}) (prior app: ${this._currentAppId || 'unknown'})`);
                this._send('launch_app', this._selectedId, app.id);
            }
            return Clutter.EVENT_STOP;
        });

        return btn;
    }

    // TV app button: shows logo fruit icon + "TV" text on dark background
    _makeFruitTVButton(app) {
        const btn = new St.Button({
            style_class: 'fruittv-quick-app-btn fruittv-app-color-tv',
            can_focus: true,
        });

        const box = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });

        const fruitPath = `${this._extension.path}/icons/fruits/${this._extension.getLogoFruit()}-symbolic.svg`;
        const fruitFile = Gio.File.new_for_path(fruitPath);
        const icon = new St.Icon({
            gicon: new Gio.FileIcon({ file: fruitFile }),
            icon_size: 22,
            style_class: 'fruittv-app-fruit-icon',
        });
        box.add_child(icon);

        const label = new St.Label({
            text: 'TV',
            style_class: 'fruittv-quick-app-label',
            x_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(label);

        btn.set_child(box);

        btn.connect('button-press-event', () => {
            if (this._selectedId) {
                log(`[FruitTV] Quick-launching TV app (${app.id})`);
                this._send('launch_app', this._selectedId, app.id);
            }
            return Clutter.EVENT_STOP;
        });

        return btn;
    }

    // Issue 6: toggle the bright-green active border on matching app button
    _updateActiveAppBorder(appId) {
        this._currentAppId = appId;
        for (const [id, btn] of this._appBtnMap) {
            if (id === appId) {
                btn.add_style_class_name('fruittv-app-active');
            } else {
                btn.remove_style_class_name('fruittv-app-active');
            }
        }
    }

    // ── Device management dialog ─────────────────────────────────────────

    _openDeviceDialog() {
        const dialog = new DeviceDialog(this, () => {
            this._loadDevices();
            this.menu.open();
        });
        dialog.open();
    }

    // ── Device loading ───────────────────────────────────────────────────

    async _loadDevices() {
        try {
            const [stdout] = await this._send('list_devices');
            const parsed = JSON.parse(stdout);
            const devices = parsed.devices || [];

            if (!this._selectedId && parsed.selected)
                this._selectedId = parsed.selected;
            if (!this._selectedId && devices.length > 0)
                this._selectedId = devices[0].id;

            this._devices.clear();
            for (const d of devices)
                this._devices.set(d.id, d);

            if (this._selectedId) {
                this._updatePowerStatus(this._selectedId);
                this._startPolling();
                this._validateFavorites();
            }
        } catch (e) {
            log(`FruitTV-Remote _loadDevices error: ${e}`);
        }
    }

    async _validateFavorites() {
        if (!this._selectedId) return;
        try {
            const [stdout] = await this._send('list_apps', this._selectedId);
            const res = JSON.parse(stdout);
            const apps = res.apps || [];
            if (apps.length === 0) return;

            const config = this._extension._readAppsConfig();
            const favorites = (config.favorites.length > 0 || config.hasFile)
                ? [...config.favorites]
                : [...DEFAULT_FAVORITE_APPS];

            // Save full app list to enable icon downloading for all apps
            this._extension._saveAppsConfig(favorites, apps);
            this._extension._startColorFetcher();

            // Validate favorites: remove any that no longer exist on device
            const appIds = new Set(apps.map(a => a.id));
            let changed = false;
            for (const fav of favorites) {
                if (!appIds.has(fav.id)) {
                    this._extension.setAppFavorite(this._selectedId, fav, false);
                    changed = true;
                }
            }
            if (changed) {
                this._refreshAppButtons();
            }
        } catch (e) {
            log(`[FruitTV] Error validating favorites: ${e}`);
        }
    }

    // ── Shared helpers ──────────────────────────────────────────────────

    _setRemoteReady(isReady) {
        if (!this._remoteLight) return;
        this._remoteLight.opacity = isReady ? 255 : 0;
    }

    _togglePower() {
        if (!this._selectedId) return;
        const state = this._powerStates.get(this._selectedId);
        const command = state === 'on' ? 'power_off' : 'power_on';
        this._send(command, this._selectedId).catch(() => {});
    }

    _button(command, icon_name, style_class) {
        const btn = new St.Button({
            style_class,
            can_focus: true,
        });
        btn.set_child(new St.Icon({ icon_name, style_class: 'popup-menu-icon' }));
        if (command) {
            btn.connect('button-press-event', () => this._send(command, this._selectedId));
        }
        return btn;
    }

    async _openAppSelector() {
        log('[FruitTV] App selector button pressed');
        if (!this._selectedId) {
            log('[FruitTV] No device selected');
            return;
        }
        const device = this._devices.get(this._selectedId);
        if (!device) {
            log('[FruitTV] Device not found in map, sending home');
            this._send('home', this._selectedId).catch(() => {});
            return;
        }

        try {
            log('[FruitTV] Requesting app list...');
            const [stdout] = await this._send('list_apps', this._selectedId);
            const res = JSON.parse(stdout);
            const apps = res.apps || [];
            log(`[FruitTV] Got ${apps.length} apps`);
            if (apps.length === 0) {
                log('[FruitTV] No apps, sending home');
                this._send('home', this._selectedId).catch(() => {});
                return;
            }
            log('[FruitTV] Opening app dialog');
            this._openAppDialog(device);
        } catch (e) {
            log(`[FruitTV] Error getting apps: ${e}, sending home`);
            this._send('home', this._selectedId).catch(() => {});
        }
    }

    _openAppDialog(device) {
        const dialog = new AppDialog(this._extension, device, () => {
            this._refreshAppButtons();
            this.menu.open();
        });
        dialog.open();
    }

    async _updatePowerStatus(deviceId, forceState) {
        const setState = (state) => {
            this._powerStates.set(deviceId, state);
            if (deviceId === this._selectedId) {
                this._setRemoteReady(state === 'on' || state === 'off');
            }
        };

        if (typeof forceState === 'boolean') {
            setState(forceState ? 'on' : 'off');
            return;
        }

        try {
            const [stdout] = await this._send('power_state', deviceId);
            const res = JSON.parse(stdout);
            setState(res.on ? 'on' : 'off');
        } catch (e) {
            setState('unavailable');
        }
    }

    _selectDevice(deviceId) {
        this._selectedId = deviceId;
        this._stopPolling();
        const state = this._powerStates.get(deviceId);
        this._setRemoteReady(state === 'on' || state === 'off');
        this._startPolling();
    }

    // --- Polling for metadata ---
    _startPolling() {
        if (this._pollTimer) return;
        this._pollMetadata();
        this._pollTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._pollMetadata();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPolling() {
        if (this._pollTimer) {
            GLib.source_remove(this._pollTimer);
            this._pollTimer = null;
        }
    }

    async _pollMetadata() {
        if (!this._selectedId) return;
        try {
            const [stdout] = await this._send('get_metadata', this._selectedId);
            const res = JSON.parse(stdout);
            this._updateMetadata(res);
            this._updatePowerStatus(this._selectedId);
        } catch (e) {
            this._updateMetadata(null);
        }
    }

    _updateMetadata(r) {
        if (!r || !r.title) {
            this._updateActiveAppBorder(null);
            return;
        }

        // Log metadata changes (excluding playback position/duration)
        if (r.title !== this._lastTitle) {
            this._lastTitle = r.title;
            log(`[FruitTV] Metadata: title="${r.title || ''}", artist="${r.artist || ''}", album="${r.album || ''}", series="${r.series || ''}", device_state="${r.device_state || ''}", app_id="${r.app_id || ''}"`);
        }

        // Issue 6: highlight the button for the currently active app
        this._updateActiveAppBorder(r.app_id ?? null);
    }

    // ── Daemon lifecycle ───────────────────────────────────────────────

    _ensureDaemon() {
        if (this._daemon && !this._daemon.get_if_exited()) return;
        if (this._daemon) this._cleanupDaemon();

        const daemonPath = `${GLib.get_home_dir()}/.config/appletv-remote/ftv_daemon.py`;
        this._daemon = new Gio.Subprocess({
            argv: [daemonPath],
            flags: Gio.SubprocessFlags.STDIN_PIPE |
                   Gio.SubprocessFlags.STDOUT_PIPE |
                   Gio.SubprocessFlags.STDERR_PIPE,
        });
        this._daemon.init(null);

        this._daemonStdin = new Gio.DataOutputStream({
            base_stream: this._daemon.get_stdin_pipe(),
        });
        this._daemonStdout = new Gio.DataInputStream({
            base_stream: this._daemon.get_stdout_pipe(),
        });
        this._pendingRequests = new Map();
        this._cmdId = 0;
        this._readLoop();
    }

    _readLoop() {
        if (!this._daemonStdout) return;
        this._daemonStdout.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, result) => {
            try {
                const [line] = stream.read_line_finish_utf8(result);
                if (line !== null) {
                    this._handleResponse(line);
                    this._readLoop();
                } else {
                    // EOF — daemon exited unexpectedly
                    this._cleanupDaemon();
                }
            } catch (e) {
                log(`FruitTV-Remote daemon read error: ${e}`);
            }
        });
    }

    _handleResponse(line) {
        try {
            const msg = JSON.parse(line);
            const pending = this._pendingRequests.get(msg.id);
            if (!pending) return;
            this._pendingRequests.delete(msg.id);
            if (msg.error) {
                pending.reject(new Error(msg.error));
            } else {
                // Return [stdout_json, ''] to match the interface callers expect
                pending.resolve([JSON.stringify(msg.result), '']);
            }
        } catch (e) {
            log(`FruitTV-Remote daemon response parse error: ${e}`);
        }
    }

    _cleanupDaemon() {
        try { this._daemonStdin?.close(null); } catch (_e) {}
        this._daemonStdin = null;
        this._daemonStdout = null;
        for (const [, pending] of this._pendingRequests) {
            pending.reject(new Error('Daemon process exited'));
        }
        this._pendingRequests = new Map();
        this._daemon = null;
    }

    // ── Command dispatch ───────────────────────────────────────────────

    async _send(command, ...extraArgs) {
        this._ensureDaemon();
        const id = String(++this._cmdId);
        const payload = JSON.stringify({
            id,
            cmd: command,
            args: extraArgs.filter(a => a !== null && a !== undefined),
        }) + '\n';

        return new Promise((resolve, reject) => {
            this._pendingRequests.set(id, { resolve, reject });
            try {
                this._daemonStdin.put_string(payload, null);
            } catch (e) {
                this._pendingRequests.delete(id);
                reject(e);
            }
        });
    }

    destroy() {
        this._stopPolling();
        if (this._selectTimer) {
            GLib.source_remove(this._selectTimer);
            this._selectTimer = null;
        }
        this._cleanupDaemon();
        super.destroy();
    }
});


export default class FruitTVRemoteExtension extends Extension {
    enable() {
        log('FruitTV-Remote: enable()');
        this._appColors = {};
        this._colorMonitor = null;
        this._loadLogoFruit();
        this._loadAppColors();
        this._indicator = new FruitTVIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._watchColorFile();
        this._startColorFetcher();
    }

    disable() {
        log('FruitTV-Remote: disable()');
        if (this._colorMonitor) {
            this._colorMonitor.cancel();
            this._colorMonitor = null;
        }
        this._indicator?.destroy();
        this._indicator = null;
        this._appColors = {};
    }

    // ── Logo fruit setting ─────────────────────────────────────────────

    _settingsPath() {
        return `${GLib.get_home_dir()}/.config/appletv-remote/settings.json`;
    }

    _loadLogoFruit() {
        try {
            const [ok, bytes] = GLib.file_get_contents(this._settingsPath());
            if (ok) {
                const cfg = JSON.parse(new TextDecoder().decode(bytes));
                if (cfg && typeof cfg.logo_fruit === 'string') {
                    this._logoFruit = cfg.logo_fruit;
                    return;
                }
            }
        } catch (_e) {}
        this._logoFruit = 'lemon';
    }

    _saveLogoFruit(fruit) {
        this._logoFruit = fruit;
        try {
            const file = Gio.File.new_for_path(this._settingsPath());
            file.replace_contents(
                new TextEncoder().encode(JSON.stringify({ logo_fruit: fruit }, null, 2)),
                null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null
            );
        } catch (e) {
            log(`FruitTV-Remote: failed to save logo fruit setting: ${e}`);
        }
    }

    getLogoFruit() {
        return this._logoFruit || 'lemon';
    }

    // ── App colour management ──────────────────────────────────────────

    _colorsConfigPath() {
        return `${GLib.get_home_dir()}/.config/appletv-remote/app_colors.json`;
    }

    _loadAppColors() {
        try {
            const [ok, bytes] = GLib.file_get_contents(this._colorsConfigPath());
            if (ok) {
                const parsed = JSON.parse(new TextDecoder().decode(bytes));
                if (parsed && typeof parsed === 'object') {
                    this._appColors = parsed;
                }
            }
        } catch (_e) {}
    }

    getAppColor(appId) {
        return this._appColors?.[appId] || null;
    }

    hasAppBeenProcessed(appId) {
        return this._appColors != null && appId in this._appColors;
    }

    _watchColorFile() {
        const file = Gio.File.new_for_path(this._colorsConfigPath());
        try {
            this._colorMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._colorMonitor.connect('changed', () => {
                this._loadAppColors();
                this._indicator?._refreshAppButtons();
            });
        } catch (e) {
            log(`FruitTV-Remote: failed to watch color file: ${e}`);
        }
    }

    _startColorFetcher() {
        const venvPython  = `${GLib.get_home_dir()}/.config/appletv-remote/venv/bin/python3`;
        const fetcherPath = `${GLib.get_home_dir()}/.config/appletv-remote/ftv_color_fetcher.py`;
        try {
            const fetcher = new Gio.Subprocess({
                argv: [venvPython, fetcherPath],
                flags: Gio.SubprocessFlags.NONE,
            });
            fetcher.init(null);
        } catch (e) {
            log(`FruitTV-Remote: could not start color fetcher: ${e}`);
        }
    }

    // ── App favorites config ───────────────────────────────────────────

    _appsConfigPath() {
        return `${GLib.get_home_dir()}/.config/appletv-remote/apps.json`;
    }

    _readAppsConfig() {
        try {
            const [ok, bytes] = GLib.file_get_contents(this._appsConfigPath());
            if (ok) {
                const cfg = JSON.parse(new TextDecoder().decode(bytes));
                const favorites = Array.isArray(cfg.favorites) ? cfg.favorites : [];
                const apps = Array.isArray(cfg.apps) ? cfg.apps : [];
                return { favorites, apps, hasFile: true };
            }
        } catch (_e) {}
        return { favorites: [], apps: [], hasFile: false };
    }

    _saveAppsConfig(favorites, apps) {
        try {
            const file = Gio.File.new_for_path(this._appsConfigPath());
            file.replace_contents(
                new TextEncoder().encode(JSON.stringify({ favorites, apps }, null, 2)),
                null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null
            );
        } catch (e) {
            log(`FruitTV-Remote: failed to save apps config: ${e}`);
        }
    }

    getFavoriteAppObjects() {
        const { favorites, hasFile } = this._readAppsConfig();
        if (favorites.length > 0) {
            return favorites;
        }
        if (!hasFile) {
            return [...DEFAULT_FAVORITE_APPS];
        }
        return favorites;
    }

    getFavoriteApps(_deviceId) {
        return this.getFavoriteAppObjects().map(a => a.id);
    }

    setAppFavorite(_deviceId, app, isFavorite) {
        const config = this._readAppsConfig();
        const favorites = (config.favorites.length > 0 || config.hasFile)
            ? [...config.favorites]
            : [...DEFAULT_FAVORITE_APPS];
        const idx = favorites.findIndex(a => a.id === app.id);
        if (isFavorite && idx === -1) {
            if (favorites.length >= 15) {
                Main.notify('Fruit TV Remote', 'Maximum of 15 favorite apps reached');
                return false;
            }
            favorites.push({ id: app.id, name: app.name });
        } else if (!isFavorite && idx !== -1) {
            favorites.splice(idx, 1);
        } else {
            return true; // no change needed
        }
        this._saveAppsConfig(favorites, config.apps || []);
        return true;
    }

    // ── App icon resolution ────────────────────────────────────────────

    getAppIconSync(app) {
        // TV app uses fruit+TV rendering — skip icon file lookup
        if (app.id === TV_APP_ID) return null;

        const iconDir  = `${this.path}/icons/apps`;
        const cacheDir = `${GLib.get_home_dir()}/.config/appletv-remote/icons`;

        for (const p of [
            `${iconDir}/${app.id}.png`,
            `${iconDir}/${app.name.toLowerCase()}.png`,
            `${cacheDir}/${app.id}.png`,
        ]) {
            const f = Gio.File.new_for_path(p);
            if (f.query_exists(null)) return f;
        }
        return null;
    }

    async getAppIcon(app) {
        return this.getAppIconSync(app);
    }

    async getApps(deviceId) {
        const [stdout] = await this._indicator._send('list_apps', deviceId);
        const res = JSON.parse(stdout);
        if (res.error) {
            throw new Error(res.error);
        }
        const apps = res.apps || [];
        const config = this._readAppsConfig();
        const favorites = (config.favorites.length > 0 || config.hasFile)
            ? config.favorites
            : [...DEFAULT_FAVORITE_APPS];
        this._saveAppsConfig(favorites, apps);
        this._startColorFetcher();
        return apps;
    }

    // ── Public API for other extensions ────────────────────────────────

    getSelectedDevice() {
        return this._indicator?._selectedId ?? null;
    }

    sendCommand(command, ...args) {
        return this._indicator?._send(command, ...args)
            ?? Promise.reject(new Error('FruitTV Remote not ready'));
    }
}
