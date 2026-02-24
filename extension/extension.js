
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

// Helper to run async subprocess command with Promise
async function execCommand(proc, cancellable) {
    return new Promise((resolve, reject) => {
        proc.communicate_utf8_async(null, cancellable, (proc, result) => {
            try {
                const [ok, stdout, stderr] = proc.communicate_utf8_finish(result);
                resolve([stdout, stderr]);
            } catch (e) {
                reject(e);
            }
        });
    });
}

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
        this._selectedId = null;
        this._pollTimer = null;
        this._lastTitle = null;
        this._appsLoaded = false;

        this._buildMenu();
        this.menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen) {
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

        // Apps submenu
        this._appsSubmenu = new PopupMenu.PopupSubMenuMenuItem(_('Apps'));
        this.menu.addMenuItem(this._appsSubmenu);

        this._appsSubmenu.menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen && !this._appsLoaded) {
                this._refreshApps();
            }
        });


        // --- Controls ---
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Menu / Home
        this._centeredRow(row => {
            row.add_child(this._button('menu', 'view-more-symbolic', 'appletv-icon-btn'));
            row.add_child(this._button('top_menu', 'go-top-symbolic', 'appletv-icon-btn'));
            row.add_child(this._button('home', 'go-home-symbolic', 'appletv-icon-btn'));
        });

        // Navigation
        this._navItem();

        // Playback
        this._centeredRow(row => {
            row.add_child(this._button('previous_track', 'media-skip-backward-symbolic', 'appletv-icon-btn'));
            row.add_child(this._button('rewind', 'media-seek-backward-symbolic', 'appletv-icon-btn'));
            row.add_child(this._button('play_pause', 'media-playback-start-symbolic', 'appletv-icon-btn'));
            row.add_child(this._button('fast_forward', 'media-seek-forward-symbolic', 'appletv-icon-btn'));
            row.add_child(this._button('next_track', 'media-skip-forward-symbolic', 'appletv-icon-btn'));
            row.add_child(this._button('stop', 'media-playback-stop-symbolic', 'appletv-icon-btn'));
        });

        this._positionLabel = new St.Label({ text: '', style_class: 'appletv-position-label' });
        const positionBin = new St.Bin({ child: this._positionLabel, x_align: Clutter.ActorAlign.CENTER });
        const positionItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        positionItem.add_child(positionBin);
        this.menu.addMenuItem(positionItem);


        // Volume
        this._centeredRow(row => {
            row.add_child(this._button('volume_down', 'audio-volume-low-symbolic', 'appletv-icon-btn'));
            row.add_child(this._button('volume_up', 'audio-volume-high-symbolic', 'appletv-icon-btn'));
        });

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
        const textEntryItem = new PopupMenu.PopupBaseMenuItem();
        textEntryItem.add_child(textEntry);
        this.menu.addMenuItem(textEntryItem);
        textEntry.clutter_text.connect('activate', () => {
            const text = textEntry.get_text();
            if (text) {
                this._send('keyboard_set', text);
                textEntry.set_text('');
            }
        });

    }

    _centeredRow(buildFn) {
        const row = new St.BoxLayout({ style_class: 'appletv-control-row' });
        buildFn(row);
        const bin = new St.Bin({ child: row, x_align: Clutter.ActorAlign.CENTER });
        const item = new PopupMenu.PopupBaseMenuItem();
        item.add_child(bin);
        this.menu.addMenuItem(item);
    }

    _navItem() {
        const grid = new St.BoxLayout({ vertical: true, style_class: 'appletv-nav-grid' });

        const row1 = new St.BoxLayout({ style_class: 'appletv-nav-row' });
        row1.add_child(new St.Label({ text: ' ', style: 'min-width: 36px;' }));
        row1.add_child(this._button('up', 'pan-up-symbolic', 'appletv-nav-btn'));
        row1.add_child(new St.Label({ text: ' ', style: 'min-width: 36px;' }));
        grid.add_child(row1);

        const row2 = new St.BoxLayout({ style_class: 'appletv-nav-row' });
        row2.add_child(this._button('left', 'pan-start-symbolic', 'appletv-nav-btn'));
        row2.add_child(this._button('select', 'media-record-symbolic', 'appletv-nav-btn'));
        row2.add_child(this._button('right', 'pan-end-symbolic', 'appletv-nav-btn'));
        grid.add_child(row2);

        const row3 = new St.BoxLayout({ style_class: 'appletv-nav-row' });
        row3.add_child(new St.Label({ text: ' ', style: 'min-width: 36px;' }));
        row3.add_child(this._button('down', 'pan-down-symbolic', 'appletv-nav-btn'));
        row3.add_child(new St.Label({ text: ' ', style: 'min-width: 36px;' }));
        grid.add_child(row3);

        const bin = new St.Bin({ child: grid, x_align: Clutter.ActorAlign.CENTER });
        const item = new PopupMenu.PopupBaseMenuItem();
        item.add_child(bin);
        this.menu.addMenuItem(item);
    }


    _button(command, icon_name, style_class) {
        const btn = new St.Button({
            style_class,
            can_focus: true,
        });
        btn.set_child(new St.Icon({ icon_name, style_class: 'popup-menu-icon' }));
        if (command) {
            btn.connect('button-press-event', () => this._send(command));
        }
        return btn;
    }

    async _refreshDeviceList() {
        this.deviceSection.removeAll();
        this._powerButtons.clear();
        this._statusLabels.clear();
        this._powerStates.clear();
        this._deviceMenuItems.clear();

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
    
    _openAppDialog() {
        const dialog = new AppDialog(this._extension, this._atvDevice, () => {
             this._refreshFavoriteApps();
        });
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
        this._resetAppsPlaceholder();
    }

    _resetAppsPlaceholder() {
        this._appsLoaded = false;
        this._appsSubmenu.menu.removeAll();
        const placeholder = new PopupMenu.PopupMenuItem(_('Loading...'));
        this._appsSubmenu.menu.addMenuItem(placeholder);
    }
    
    async _refreshApps() {
        if (!this._selectedId) return;
        this._appsSubmenu.menu.removeAll();
        this._appsLoaded = true;

        try {
            const [stdout] = await this._send('list_apps', this._selectedId);
            const apps = JSON.parse(stdout);

            if (apps.error) {
                this._appsSubmenu.menu.addMenuItem(new PopupMenu.PopupMenuItem(apps.error));
                return;
            }

            if (apps.length === 0) {
                this._appsSubmenu.menu.addMenuItem(new PopupMenu.PopupMenuItem(_('No apps found.')));
            } else {
                for (const app of apps) {
                    const item = new PopupMenu.PopupMenuItem(app.name);
                    item.connect('activate', () => this._send('launch_app', this._selectedId, app.id));
                    this._appsSubmenu.menu.addMenuItem(item);
                }
            }
        } catch (e) {
            this._appsSubmenu.menu.addMenuItem(new PopupMenu.PopupMenuItem(_('Error loading apps.')));
            log(e);
        }
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


    async _send(command, ...extraArgs) {
        const helperPath = `${GLib.get_home_dir()}/.config/appletv-remote/atv_control.py`;
        const argv = [helperPath, command, ...extraArgs.filter(a => a !== null)];

        const proc = new Gio.Subprocess({
            argv,
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        proc.init(null);

        const [stdout, stderr] = await execCommand(proc, null);

        if (proc.get_exit_status() !== 0) {
            log(`AppleTV-Remote Error: ${stderr}`);
            throw new Error(stderr || 'Process failed');
        }
        
        // Check for error reported in stdout json
        try {
            const res = JSON.parse(stdout);
            if(res.error) {
                log(`AppleTV-Remote Error: ${res.error}`);
                throw new Error(res.error);
            }
        } catch(e) {
            // It's ok if stdout is not json
        }

        return [stdout, stderr];
    }

    destroy() {
        this._stopPolling();
        super.destroy();
    }
});


export default class AppleTVRemoteExtension extends Extension {
    enable() {
        this._indicator = new AppleTVIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
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
        const apps = JSON.parse(stdout);
        if (apps.error) {
            throw new Error(apps.error);
        }
        return apps;
    }
}
