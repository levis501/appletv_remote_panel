
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as CheckBox from 'resource:///org/gnome/shell/ui/checkBox.js';

const AppRow = GObject.registerClass(
class AppRow extends St.BoxLayout {
    _init(extension, atvDevice, app) {
        super._init({
            style_class: 'app-row',
            can_focus: true,
            reactive: true,
        });
        this._extension = extension;
        this._atvDevice = atvDevice;
        this._app = app;

        this._icon = new St.Icon({
            icon_name: 'application-x-executable-symbolic',
            style_class: 'app-row-icon',
        });
        this.add_child(this._icon);

        const label = new St.Label({
            text: app.name,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(label);

        const spacer = new St.Bin({ x_expand: true });
        this.add_child(spacer);

        this._checkbox = new CheckBox.CheckBox();
        this.add_child(this._checkbox);

        this.connect('button-press-event', () => this._toggle());

        this._initIcon();
        this._initCheckbox();
    }

    _toggle() {
        this._checkbox.checked = !this._checkbox.checked;
    }

    async _initIcon() {
        const iconFile = await this._extension.getAppIcon(this._app);
        if (iconFile) {
            this._icon.gicon = Gio.FileIcon.new(iconFile);
        }
    }

    _initCheckbox() {
        const favorites = this._extension.getFavoriteApps(this._atvDevice.id);
        this._checkbox.checked = favorites.includes(this._app.id);

        this._checkbox.connect('notify::checked', () => {
            const isFavorite = this._checkbox.checked;
            this._extension.setAppFavorite(this._atvDevice.id, this._app.id, isFavorite);
        });
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
        this._appRows = new Map();

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

            for (const app of apps) {
                const row = new AppRow(this._extension, this._atvDevice, app);
                this.add_child(row);
                this._appRows.set(app.id, row);
            }
        } catch (e) {
            this.remove_child(loading);
            this.add_child(new St.Label({ text: _('Error loading apps: %s').format(e.message) }));
            log(e);
        }
    }
});
