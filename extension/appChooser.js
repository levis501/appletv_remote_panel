import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// CSS class to apply for each known app's brand color
const APP_COLOR_CLASSES = {
    'com.apple.TVWatchList':   'appletv-app-color-tv',
    'com.apple.TVMusic':       'appletv-app-color-music',
    'com.apple.TVSettings':    'appletv-app-color-settings',
    'com.google.ios.youtube':  'appletv-app-color-youtube',
    'com.netflix.Netflix':     'appletv-app-color-netflix',
    'com.hulu.HuluTV':         'appletv-app-color-hulu',
};

const APP_TILE_WIDTH = 89;  // 59 * 1.5 for wider dialog buttons
const APP_TILE_HEIGHT = 50;
const TILES_PER_ROW = 3;
const COL_SPACING = 12;
const ROW_SPACING = 12;
const START_X = 12;
const START_Y = 12;

const AppTile = GObject.registerClass(
class AppTile extends St.Button {
    _init(extension, atvDevice, app) {
        super._init({
            style_class: 'appletv-quick-app-btn appletv-app-chooser-btn',
            can_focus: true,
            reactive: true,
        });
        this._extension = extension;
        this._atvDevice = atvDevice;
        this._app = app;

        const iconFile = this._extension.getAppIconSync(app);
        const colorClass = iconFile ? null : (APP_COLOR_CLASSES[app.id] || null);
        if (colorClass) {
            this.add_style_class_name(colorClass);
        }

        const box = new St.BoxLayout({ vertical: true, x_align: Clutter.ActorAlign.CENTER });
        this.set_child(box);

        if (iconFile) {
            this._icon = new St.Icon({
                gicon: new Gio.FileIcon({ file: iconFile }),
                style_class: 'appletv-quick-app-icon',
            });
            box.add_child(this._icon);
        }

        const label = new St.Label({
            text: app.name,
            style_class: 'appletv-quick-app-label',
            x_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(label);

        this.connect('button-press-event', () => this._toggle());

        this._selected = false;
        this._initSelection();
    }

    _initSelection() {
        const favorites = this._extension.getFavoriteApps(this._atvDevice.id);
        this._selected = favorites.includes(this._app.id);
        this._updateStyle();
    }

    _toggle() {
        this._selected = !this._selected;
        this._extension.setAppFavorite(this._atvDevice.id, this._app, this._selected);
        this._updateStyle();
    }

    _updateStyle() {
        if (this._selected) {
            this.add_style_class_name('appletv-app-active');
        } else {
            this.remove_style_class_name('appletv-app-active');
        }
    }
});


export const AppChooser = GObject.registerClass(
class AppChooser extends St.BoxLayout {
    _init(extension, atvDevice) {
        super._init({
            vertical: true,
            style_class: 'app-chooser',
        });

        this._extension = extension;
        this._atvDevice = atvDevice;
        this._appButtons = new Map();

        // Use manual FixedLayout positioning instead of FlowLayout to avoid
        // CSS/layout timing races. No preferred-size measurement occurs.
        this._grid = new St.Widget({
            layout_manager: new Clutter.FixedLayout(),
            style_class: 'app-chooser-grid',
            x_expand: true,
            y_expand: true,
        });
        this.add_child(this._grid);

        this._loadApps();
    }

    async _loadApps() {
        const loading = new St.Label({ text: _('Loading apps...'), style_class: 'loading-label' });
        this.add_child(loading);

        try {
            const apps = await this._extension.getApps(this._atvDevice.id);
            this.remove_child(loading);

            if (!apps || apps.length === 0) {
                this.add_child(new St.Label({ text: _('No apps found or Companion is not paired.') }));
                return;
            }

            apps.sort((a, b) => a.name.localeCompare(b.name));

            // Issue 1: Remove apps from favorites if they no longer exist on device
            const favorites = this._extension.getFavoriteAppObjects();
            const appIds = new Set(apps.map(a => a.id));
            for (const fav of favorites) {
                if (!appIds.has(fav.id)) {
                    this._extension.setAppFavorite(this._atvDevice.id, fav, false);
                }
            }

            for (let i = 0; i < apps.length; i++) {
                const app = apps[i];
                const btn = new AppTile(this._extension, this._atvDevice, app);
                btn.set_size(APP_TILE_WIDTH, APP_TILE_HEIGHT);

                // Manual positioning: calculate grid row/col and set position
                const col = i % TILES_PER_ROW;
                const row = Math.floor(i / TILES_PER_ROW);
                const x = START_X + col * (APP_TILE_WIDTH + COL_SPACING);
                const y = START_Y + row * (APP_TILE_HEIGHT + ROW_SPACING);

                this._grid.add_child(btn);
                btn.set_position(x, y);
                this._appButtons.set(app.id, btn);
            }

            // Set grid size to accommodate all tiles
            const totalRows = Math.ceil(apps.length / TILES_PER_ROW);
            const gridHeight = START_Y + totalRows * (APP_TILE_HEIGHT + ROW_SPACING);
            this._grid.set_size(315, gridHeight);
        } catch (e) {
            this.remove_child(loading);
            this.add_child(new St.Label({ text: _('Error loading apps: %s').format(e.message) }));
            log(e);
        }
    }
});
