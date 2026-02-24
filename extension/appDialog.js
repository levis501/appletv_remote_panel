
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import { AppChooser } from './appChooser.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';


export const AppDialog = GObject.registerClass(
class AppDialog extends ModalDialog.ModalDialog {
    _init(extension, atvDevice, onClosed) {
        super._init({
            styleClass: 'app-dialog',
            destroyOnClose: true,
        });
        this._extension = extension;
        this._atvDevice = atvDevice;
        this._onClosed = onClosed;

        this._buildLayout();
    }

    _buildLayout() {
        const title = new St.Label({
            text: _('Select Apps for %s').format(this._atvDevice.name),
            style_class: 'app-dialog-title',
        });

        this.contentLayout.add_child(title);

        const scrollView = new St.ScrollView({
            style_class: 'app-dialog-scroll-view',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        this.contentLayout.add_child(scrollView);

        this._appChooser = new AppChooser(this._extension, this._atvDevice);
        scrollView.add_child(this._appChooser);

        this.setButtons([
            {
                label: _('Close'),
                action: () => this.close(),
                key: Clutter.KEY_Escape,
            },
        ]);
    }

    close() {
        this._onClosed();
        super.close();
    }
});
