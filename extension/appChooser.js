import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// CSS class to apply for each known app's brand color
const APP_COLOR_CLASSES = {
    'com.apple.TVWatchList':   'fruittv-app-color-tv',
    'com.apple.TVMusic':       'fruittv-app-color-music',
    'com.apple.TVSettings':    'fruittv-app-color-settings',
    'com.google.ios.youtube':  'fruittv-app-color-youtube',
    'com.netflix.Netflix':     'fruittv-app-color-netflix',
    'com.hulu.HuluTV':         'fruittv-app-color-hulu',
};

// The TV app ID gets special fruit+TV rendering
const TV_APP_ID = 'com.apple.TVWatchList';

const APP_TILE_WIDTH = 50;
const APP_TILE_HEIGHT = 50;
const TILES_PER_ROW = 4;
const COL_SPACING = 12;
const ROW_SPACING = 12;
const START_X = 12;
const START_Y = 12;
const MIN_WRAP_CHARS = 9;

function wrapAppName(name) {
    if (!name || name.length < MIN_WRAP_CHARS) {
        return name;
    }

    const mid = Math.floor(name.length / 2);
    const spaceIndices = [];
    for (let i = 1; i < name.length - 1; i++) {
        if (name[i] === ' ') {
            spaceIndices.push(i);
        }
    }
    if (spaceIndices.length > 0) {
        let bestIdx = spaceIndices[0];
        let bestDist = Math.abs(spaceIndices[0] - mid);
        for (const idx of spaceIndices) {
            const dist = Math.abs(idx - mid);
            if (dist < bestDist) {
                bestIdx = idx;
                bestDist = dist;
            }
        }
        const left = name.slice(0, bestIdx + 1).trimEnd();
        const right = name.slice(bestIdx + 1).trimStart();
        return `${left}\n${right}`;
    }

    const capIndices = [];
    for (let i = 1; i < name.length; i++) {
        const ch = name[i];
        if (ch >= 'A' && ch <= 'Z') {
            capIndices.push(i);
        }
    }
    if (capIndices.length > 0) {
        let bestIdx = capIndices[0];
        let bestDist = Math.abs(capIndices[0] - mid);
        for (const idx of capIndices) {
            const dist = Math.abs(idx - mid);
            if (dist < bestDist) {
                bestIdx = idx;
                bestDist = dist;
            }
        }
        return `${name.slice(0, bestIdx)}\n${name.slice(bestIdx)}`;
    }

    return `${name.slice(0, mid)}\n${name.slice(mid)}`;
}

const AppTile = GObject.registerClass(
class AppTile extends St.Button {
    _init(extension, atvDevice, app) {
        super._init({
            style_class: 'fruittv-quick-app-btn fruittv-app-chooser-btn',
            can_focus: true,
            reactive: true,
        });
        this._extension = extension;
        this._atvDevice = atvDevice;
        this._app = app;

        // TV app gets special fruit + "TV" rendering
        if (app.id === TV_APP_ID) {
            this._buildFruitTVContent(extension);
        } else {
            this._buildNormalContent(extension, app);
        }

        this.connect('button-press-event', () => this._toggle());

        this._selected = false;
        this._initSelection();
    }

    _buildFruitTVContent(extension) {
        this.add_style_class_name('fruittv-app-color-tv');

        const box = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });

        const fruitPath = `${extension.path}/icons/fruits/${extension.getLogoFruit()}-symbolic.svg`;
        const icon = new St.Icon({
            gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(fruitPath) }),
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

        this.set_child(box);
    }

    _buildNormalContent(extension, app) {
        const iconFile      = extension.getAppIconSync(app);
        const fetchedColors = extension.getAppColor(app.id);
        const isLoading     = !iconFile && !extension.hasAppBeenProcessed(app.id);

        // Priority: fetched colors > CSS brand class (only when no icon, not loading, no fetched colors)
        const colorClass = (!iconFile && !fetchedColors && !isLoading) ? (APP_COLOR_CLASSES[app.id] || null) : null;
        if (colorClass) {
            this.add_style_class_name(colorClass);
        }

        if (iconFile) {
            // Real icon fills the whole button — no label
            this.add_style_class_name('fruittv-quick-app-btn-with-icon');
            this.set_style(
                `background-image: url("${iconFile.get_path()}"); ` +
                `background-size: ${APP_TILE_WIDTH}px ${APP_TILE_HEIGHT}px; ` +
                'background-position: center; background-repeat: no-repeat;'
            );
        } else if (isLoading) {
            // Loading state: black background with centered white app name
            const loadingPath = `${extension.path}/icons/apps/loading.png`;
            this.set_style(
                `background-image: url("${loadingPath}"); ` +
                'background-size: 100% 100%; background-repeat: no-repeat;'
            );
            this.set_child(new St.Label({
                text: wrapAppName(app.name),
                style_class: 'fruittv-quick-app-label',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            }));
        } else {
            // Color fallback — centered label
            if (fetchedColors) {
                this.set_style(`background-color: ${fetchedColors.bg};`);
            }
            const label = new St.Label({
                text: wrapAppName(app.name),
                style_class: 'fruittv-quick-app-label',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            if (fetchedColors) {
                label.set_style(`color: ${fetchedColors.text};`);
            }
            this.set_child(label);
        }
    }

    _initSelection() {
        const favorites = this._extension.getFavoriteApps(this._atvDevice.id);
        this._selected = favorites.includes(this._app.id);
        this._updateStyle();
    }

    _toggle() {
        const newState = !this._selected;
        const success = this._extension.setAppFavorite(this._atvDevice.id, this._app, newState);
        if (success) {
            this._selected = newState;
            this._updateStyle();
        }
    }

    _updateStyle() {
        if (this._selected) {
            this.add_style_class_name('fruittv-app-active');
        } else {
            this.remove_style_class_name('fruittv-app-active');
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

            // Remove apps from favorites if they no longer exist on device
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
            const gridHeight = (START_Y * 2) + (totalRows * APP_TILE_HEIGHT) + ((totalRows - 1) * ROW_SPACING);
            const gridWidth = (START_X * 2) + (TILES_PER_ROW * APP_TILE_WIDTH) + ((TILES_PER_ROW - 1) * COL_SPACING);
            this._grid.set_size(gridWidth, gridHeight);
        } catch (e) {
            this.remove_child(loading);
            this.add_child(new St.Label({ text: _('Error loading apps: %s').format(e.message) }));
            log(e);
        }
    }
});
