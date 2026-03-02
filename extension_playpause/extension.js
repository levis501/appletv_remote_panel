import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class FruitTVPlayPauseExtension extends Extension {
    enable() {
        this._indicator = new PanelMenu.Button(0.0, 'Fruit TV Play/Pause', true);

        this._indicator.add_child(new St.Icon({
            icon_name: 'media-playback-start-symbolic',
            style_class: 'system-status-icon',
        }));

        this._indicator.connect('button-press-event', () => {
            const main = Extension.lookupByUUID('appletv-remote@local');
            if (!main) {
                log('FruitTV-PlayPause: main extension not available');
                return;
            }
            const deviceId = main.getSelectedDevice();
            if (!deviceId) {
                log('FruitTV-PlayPause: no device selected');
                return;
            }
            main.sendCommand('play_pause', deviceId).catch(e => {
                log(`FruitTV-PlayPause: play_pause failed: ${e}`);
            });
        });

        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
