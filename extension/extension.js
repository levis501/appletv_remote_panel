
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


const AppleTVIndicator = GObject.registerClass(
class AppleTVIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Apple TV Remote', false);
        this._extension = extension;
        const iconFile = Gio.File.new_for_path(`${this._extension.path}/icons/appletv-symbolic.svg`);
        this.add_child(new St.Icon({
            gicon: new Gio.FileIcon({ file: iconFile }),
            style_class: 'system-status-icon',
        }));

        this._powerButtons = new Map();
        this._statusLabels = new Map();
        this._powerStates = new Map();
        this._deviceMenuItems = new Map();
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

        // Persistent daemon state
        this._daemon = null;
        this._daemonStdin = null;
        this._daemonStdout = null;
        this._pendingRequests = new Map();
        this._cmdId = 0;

        this._buildMenu();
        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen) {
                // Preconnect to the selected device while the device list loads
                if (this._selectedId) {
                    this._send('power_state', this._selectedId).catch(() => {});
                }
                this._refreshDeviceList();
            } else {
                this._stopPolling();
            }
        });
    }

    _buildMenu() {
        this.menu.removeAll();

        this.deviceSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this.deviceSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // --- Controls ---
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._remoteControls();

        this._positionLabel = new St.Label({ text: '', style_class: 'appletv-position-label' });
        const positionBin = new St.Bin({ child: this._positionLabel, x_align: Clutter.ActorAlign.CENTER });
        const positionItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        positionItem.add_child(positionBin);
        this.menu.addMenuItem(positionItem);


        // --- Metadata ---
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._metaBox = new St.BoxLayout({ vertical: false, style_class: 'appletv-meta-box' });
        this._artwork = new St.Icon({ style_class: 'appletv-artwork' });
        this._metaBox.add_child(this._artwork);

        this._metaTextBox = new St.BoxLayout({ vertical: true, style_class: 'appletv-meta-text-box' });
        this._metaTitle = new St.Label({ style_class: 'appletv-meta-title' });
        this._metaArtist = new St.Label({ style_class: 'appletv-meta-artist' });
        this._metaAlbum = new St.Label({ style_class: 'appletv-meta-album' });
        this._metaSeries = new St.Label({ style_class: 'appletv-meta-series' });
        this._metaTextBox.add_child(this._metaTitle);
        this._metaTextBox.add_child(this._metaArtist);
        this._metaTextBox.add_child(this._metaAlbum);
        this._metaTextBox.add_child(this._metaSeries);
        this._metaBox.add_child(this._metaTextBox);

        const metaItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        metaItem.add_child(this._metaBox);
        this.menu.addMenuItem(metaItem);


        // --- Text Input ---
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const textEntry = new St.Entry({
            hint_text: _('Type and press Enter...'),
            can_focus: true,
            style_class: 'appletv-text-entry',
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
        const remoteWidth = 239;
        const remoteHeight = 893;
        const baseWidth = 225;
        const baseHeight = 877;
        const scaleX = remoteWidth / baseWidth;
        const scaleY = remoteHeight / baseHeight;
        const yOffset = 7;
        const remote = new St.Widget({
            style_class: 'appletv-remote-graphic',
            layout_manager: new Clutter.FixedLayout(),
            reactive: false,
        });
        remote.set_size(remoteWidth, remoteHeight);
        remote.set_style(
            `background-image: url("${this._extension.path}/atv_remote.png"); ` +
            'background-size: 100% 100%; background-repeat: no-repeat;'
        );

        log(`AppleTV-Remote: loading remote graphic ${this._extension.path}/atv_remote.png`);
        const addHit = (command, x, y, w, h, className = '') => {
            const btn = new St.Button({
                style_class: `appletv-hit-btn${className ? ` ${className}` : ''}`,
                can_focus: true,
            });
            remote.add_child(btn);
            btn.set_position(Math.round(x * scaleX), Math.round((y + yOffset) * scaleY));
            btn.set_size(Math.round(w * scaleX), Math.round(h * scaleY));
            if (typeof command === 'function') {
                btn.connect('button-press-event', () => {
                    command();
                    return Clutter.EVENT_STOP;
                });
            } else if (command) {
                btn.connect('button-press-event', () => {
                    this._send(command, this._selectedId);
                    return Clutter.EVENT_STOP;
                });
            }
        };

        const light = new St.Widget({
            style_class: 'appletv-remote-light',
            reactive: false,
        });
        remote.add_child(light);
        light.set_position(Math.round(104 * scaleX), Math.round((45 + yOffset) * scaleY));
        light.set_size(Math.round(16 * scaleX), Math.round(7 * scaleY));
        this._remoteLight = light;
        this._setRemoteReady(false);

        // NOTE: Hit regions are derived from atv_remote_hitboxes.png.
        const regions = [
            { command: () => this._togglePower(), x: 133, y: 0, w: 92, h: 92 },

            { command: 'up', x: 42, y: 78, w: 143, h: 64 },
            { command: 'left', x: 5, y: 115, w: 65, h: 144 },
            { command: 'select', x: 56, y: 130, w: 114, h: 111, className: 'appletv-hit-circle' },
            { command: 'right', x: 157, y: 114, w: 67, h: 144 },
            { command: 'down', x: 43, y: 230, w: 144, h: 66 },

            { command: 'menu', x: 21, y: 291, w: 85, h: 85 },
            { command: 'home', x: 118, y: 293, w: 83, h: 83 },

            { command: 'play_pause', x: 22, y: 387, w: 83, h: 83 },
            { command: 'volume_up', x: 119, y: 386, w: 83, h: 83 },
            { command: () => this._openAppSelector(), x: 21, y: 482, w: 83, h: 83 },
            { command: 'volume_down', x: 120, y: 483, w: 83, h: 83 },
        ];

        for (const region of regions) {
            addHit(region.command, region.x, region.y, region.w, region.h, region.className || '');
        }

        const bin = new St.Bin({ child: remote, x_align: Clutter.ActorAlign.CENTER });
        const item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        item.add_child(bin);
        this.menu.addMenuItem(item);
    }

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

    async _refreshDeviceList() {
        this.deviceSection.removeAll();
        this._powerButtons.clear();
        this._statusLabels.clear();
        this._powerStates.clear();
        this._deviceMenuItems.clear();
        this._devices.clear();

        try {
            const [stdout] = await this._send('list_devices');
            const parsed = JSON.parse(stdout);
            const devices = parsed.devices || [];

            if (devices.length === 0) {
                this.deviceSection.addMenuItem(new PopupMenu.PopupMenuItem(_('No devices configured. Run atv_setup.py to add devices.')));
                return;
            }

            // Use saved selection from config if we don't have one yet
            if (!this._selectedId && parsed.selected) {
                this._selectedId = parsed.selected;
            }

            for (const device of devices) {
                const item = new PopupMenu.PopupMenuItem(device.name);
                item.connect('activate', () => this._selectDevice(device.id));

                if (this._selectedId === device.id) {
                    item.setOrnament(PopupMenu.Ornament.DOT);
                }

                // Status label: shows italic text only when not fully connected
                const statusLabel = new St.Label({
                    text: _('connecting\u2026'),
                    style_class: 'appletv-status-label',
                });
                item.add_child(statusLabel);
                this._statusLabels.set(device.id, statusLabel);
                this._powerStates.set(device.id, 'pending');

                // Power button
                const powerBtn = this._button(null, 'system-shutdown-symbolic', 'appletv-power-btn');
                powerBtn.connect('button-press-event', async (_actor, event) => {
                    event.stop();
                    const wasOn = this._powerStates.get(device.id) === 'on';
                    const command = wasOn ? 'power_off' : 'power_on';
                    this._updatePowerStatus(device.id, !wasOn); // Optimistic update
                    try {
                        await this._send(command, device.id);
                    } catch(e) {
                        this._updatePowerStatus(device.id, wasOn); // Revert on failure
                    }
                });
                item.add_child(powerBtn);
                this._powerButtons.set(device.id, powerBtn);
                this._deviceMenuItems.set(device.id, item);
                this._devices.set(device.id, device);

                this.deviceSection.addMenuItem(item);

                // Kick off async power state check — updates label when done
                this._updatePowerStatus(device.id);
            }

            // Auto-select first device if nothing is selected
            if (!this._selectedId && devices.length > 0) {
                this._selectedId = devices[0].id;
                this._deviceMenuItems.get(devices[0].id)?.setOrnament(PopupMenu.Ornament.DOT);
                this._startPolling();
            }
        } catch (e) {
            this.deviceSection.addMenuItem(new PopupMenu.PopupMenuItem(_('Error loading devices.')));
            log(e);
        }
    }
    
    async _openAppSelector() {
        log('[AppleTV] App selector button pressed');
        if (!this._selectedId) {
            log('[AppleTV] No device selected');
            return;
        }
        const device = this._devices.get(this._selectedId);
        if (!device) {
            log('[AppleTV] Device not found in map, sending home');
            this._send('home', this._selectedId).catch(() => {});
            return;
        }

        try {
            log('[AppleTV] Requesting app list...');
            const [stdout] = await this._send('list_apps', this._selectedId);
            const res = JSON.parse(stdout);
            const apps = res.apps || [];
            log(`[AppleTV] Got ${apps.length} apps`);
            if (apps.length === 0) {
                log('[AppleTV] No apps, sending home');
                this._send('home', this._selectedId).catch(() => {});
                return;
            }
            log('[AppleTV] Opening app dialog');
            this._openAppDialog(device);
        } catch (e) {
            log(`[AppleTV] Error getting apps: ${e}, sending home`);
            this._send('home', this._selectedId).catch(() => {});
        }
    }

    _openAppDialog(device) {
        const dialog = new AppDialog(this._extension, device, () => {});
        dialog.open();
    }


    async _updatePowerStatus(deviceId, forceState) {
        if (!this._statusLabels.has(deviceId)) return;
        const label = this._statusLabels.get(deviceId);

        const setState = (state) => {
            this._powerStates.set(deviceId, state);
            label.remove_style_class_name('appletv-status-unavailable');
            if (state === 'pending') {
                label.text = _('connecting\u2026');
                label.visible = true;
            } else if (state === 'unavailable') {
                label.text = _('unavailable');
                label.add_style_class_name('appletv-status-unavailable');
                label.visible = true;
            } else {
                // on or off — device is reachable, no status message needed
                label.text = '';
                label.visible = false;
            }
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
        const prevId = this._selectedId;
        this._selectedId = deviceId;

        // Update ornaments in-place without rebuilding the list
        if (prevId && this._deviceMenuItems.has(prevId)) {
            this._deviceMenuItems.get(prevId).setOrnament(PopupMenu.Ornament.NONE);
        }
        if (this._deviceMenuItems.has(deviceId)) {
            this._deviceMenuItems.get(deviceId).setOrnament(PopupMenu.Ornament.DOT);
        }

        this._stopPolling();
        this._startPolling();

        const state = this._powerStates.get(deviceId);
        this._setRemoteReady(state === 'on' || state === 'off');
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
            this._updateMetadata(null); // Clear fields on error
        }
    }

    _updateMetadata(r) {
        const hasData = r && r.title;
        this._metaBox.visible = !!hasData;
        if (!hasData) {
            this._lastTitle = null;
            return;
        }

        this._metaTitle.text = r.title || '';
        this._metaTitle.visible = !!r.title;

        this._metaArtist.text = r.artist || '';
        this._metaArtist.visible = !!r.artist;

        this._metaAlbum.text = r.album || '';
        this._metaAlbum.visible = !!r.album;

        this._metaSeries.text = r.series || '';
        this._metaSeries.visible = !!r.series;

        this._updatePosition(r.position, r.duration);
        
        if (r.title !== this._lastTitle) {
            this._lastTitle = r.title;
            this._fetchArtwork();
        }
    }
    
    _updatePosition(pos, dur) {
        if (pos && dur) {
            this._positionLabel.text = `${this._formatTime(pos)} / ${this._formatTime(dur)}`;
            this._positionLabel.visible = true;
        } else {
            this._positionLabel.visible = false;
        }
    }

    _formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const pad = n => n.toString().padStart(2, '0');

        if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
        return `${m}:${pad(s)}`;
    }
    
    async _fetchArtwork() {
        if (!this._selectedId) {
             this._artwork.gicon = null;
             this._artwork.visible = false;
             return;
        }
        try {
            const [stdout] = await this._send('get_artwork', this._selectedId);
            const res = JSON.parse(stdout);
            if (res.artwork_path) {
                const file = Gio.File.new_for_path(res.artwork_path);
                this._artwork.gicon = new Gio.FileIcon({ file });
                this._artwork.visible = true;
            } else {
                this._artwork.gicon = null;
                this._artwork.visible = false;
            }
        } catch(e) {
            this._artwork.gicon = null;
            this._artwork.visible = false;
        }
    }


    // ── Daemon lifecycle ───────────────────────────────────────────────────

    _ensureDaemon() {
        if (this._daemon && !this._daemon.get_if_exited()) return;
        if (this._daemon) this._cleanupDaemon();

        const daemonPath = `${GLib.get_home_dir()}/.config/appletv-remote/atv_daemon.py`;
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
                log(`AppleTV-Remote daemon read error: ${e}`);
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
            log(`AppleTV-Remote daemon response parse error: ${e}`);
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

    // ── Command dispatch ───────────────────────────────────────────────────

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
        this._cleanupDaemon();
        super.destroy();
    }
});


export default class AppleTVRemoteExtension extends Extension {
    enable() {
        log('AppleTV-Remote: enable()');
        this._indicator = new AppleTVIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        log('AppleTV-Remote: disable()');
        this._indicator?.destroy();
        this._indicator = null;
    }
    
    // App Management Logic that will be used by appChooser and appDialog
    
    getFavoriteApps(deviceId) {
        // Mock implementation. In the future, this will read from a settings file.
        return [];
    }
    
    setAppFavorite(deviceId, appId, isFavorite) {
        // Mock implementation. In the future, this will write to a settings file.
        log(`Setting app ${appId} as favorite=${isFavorite} for device ${deviceId}`);
    }
    
    async getAppIcon(app) {
        // In the future, this could download icons. For now, use a placeholder.
        const iconDir = this.path + '/icons/apps';
        const iconFile = Gio.File.new_for_path(iconDir + '/placeholder.png');
        return iconFile.query_exists(null) ? iconFile : null;
    }

    async getApps(deviceId) {
        const [stdout] = await this._indicator._send('list_apps', deviceId);
        const res = JSON.parse(stdout);
        if (res.error) {
            throw new Error(res.error);
        }
        return res.apps || [];
    }
}
