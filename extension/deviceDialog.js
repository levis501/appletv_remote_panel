
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';


export const DeviceDialog = GObject.registerClass(
class DeviceDialog extends ModalDialog.ModalDialog {
    _init(indicator, onClosed) {
        super._init({
            styleClass: 'appletv-device-dialog',
            destroyOnClose: true,
        });
        this._indicator = indicator;
        this._onClosed = onClosed;
        this._scanning = false;
        this._selectedId = indicator._selectedId;

        this._buildLayout();
        this._loadDevices();
    }

    _buildLayout() {
        const title = new St.Label({
            text: _('Apple TV Devices'),
            style_class: 'appletv-device-dialog-title',
        });
        this.contentLayout.add_child(title);

        this._deviceList = new St.BoxLayout({
            vertical: true,
            style_class: 'appletv-device-list',
        });

        const scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            style_class: 'appletv-device-scroll',
            x_expand: true,
        });
        scroll.add_child(this._deviceList);
        this.contentLayout.add_child(scroll);

        this._statusLabel = new St.Label({
            text: '',
            style_class: 'appletv-device-status',
            visible: false,
        });
        this.contentLayout.add_child(this._statusLabel);

        this.setButtons([
            {
                label: _('Scan'),
                action: () => this._scanDevices(),
            },
            {
                label: _('Close'),
                action: () => this.close(),
                key: Clutter.KEY_Escape,
            },
        ]);
    }

    async _loadDevices() {
        try {
            const [stdout] = await this._indicator._send('list_devices');
            const res = JSON.parse(stdout);
            this._selectedId = this._indicator._selectedId || res.selected;
            this._renderDevices(res.devices || []);
        } catch (e) {
            this._setStatus(`Error: ${e}`);
        }
    }

    _renderDevices(devices) {
        this._deviceList.destroy_all_children();
        if (devices.length === 0) {
            this._deviceList.add_child(new St.Label({
                text: _('No devices configured. Click Scan to find devices.'),
                style_class: 'appletv-device-none-label',
            }));
            return;
        }
        for (const device of devices) {
            this._deviceList.add_child(this._makeDeviceRow(device));
        }
    }

    _makeDeviceRow(device) {
        const row = new St.BoxLayout({
            style_class: 'appletv-device-row',
            x_expand: true,
        });

        const nameLabel = new St.Label({
            text: device.name || device.id,
            style_class: `appletv-device-name${device.known === false ? ' appletv-device-unregistered' : ''}`,
            x_expand: true,
        });
        row.add_child(nameLabel);

        if (device.known === false) {
            const setupBtn = new St.Button({
                label: _('Setup'),
                style_class: 'appletv-device-btn',
                can_focus: true,
            });
            setupBtn.connect('clicked', () => this._setupDevice(device.id, device.address, device.name));
            row.add_child(setupBtn);
        } else {
            const selectBtn = new St.Button({
                label: _('Select'),
                style_class: 'appletv-device-btn',
                can_focus: true,
            });
            selectBtn.connect('clicked', () => this._selectDevice(device.id));
            row.add_child(selectBtn);

            const removeBtn = new St.Button({
                label: _('Remove'),
                style_class: 'appletv-device-btn appletv-device-remove-btn',
                can_focus: true,
            });
            removeBtn.connect('clicked', () => this._removeDevice(device.id, device.name));
            row.add_child(removeBtn);
        }

        return row;
    }

    async _setupDevice(deviceId, address, name) {
        if (this._scanning) return;
        this._scanning = true;
        this._setStatus(_('Starting setup...'));
        const creds = {};
        
        let mrpSuccess = false;
        try {
            await this._pairProtocol(deviceId, address, 'mrp', creds);
            mrpSuccess = true;
        } catch (e) {
            log(`AppleTV-Remote MRP pairing failed: ${e}`);
        }
        
        let companionSuccess = false;
        try {
            await this._pairProtocol(deviceId, address, 'companion', creds);
            companionSuccess = true;
        } catch (e) {
            log(`AppleTV-Remote Companion pairing failed: ${e}`);
        }
        
        this._restoreButtons();
        this._scanning = false;
        
        if (!mrpSuccess && !companionSuccess) {
            this._setStatus(_('Setup failed for both protocols.'));
            await this._loadDevices();
            return;
        }
        
        try {
            await this._indicator._send('pair_save', deviceId, address, name, creds);
            this._setStatus(_('Setup complete.'));
            await this._loadDevices();
            if (!this._selectedId) {
                this._selectDevice(deviceId);
            }
        } catch (e) {
            this._setStatus(`Save error: ${e}`);
            await this._loadDevices();
        }
    }
    
    async _pairProtocol(deviceId, address, protocol, creds) {
        return new Promise((resolve, reject) => {
            this._setStatus(_('Connecting...'));
            this._indicator._send('pair_begin', deviceId, address, protocol)
                .then(([stdout]) => {
                    const res = JSON.parse(stdout);
                    if (res.status === 'waiting_for_pin') {
                        this._promptPin(protocol, async (pin) => {
                            if (!pin) {
                                reject(new Error('PIN cancelled'));
                                return;
                            }
                            this._setStatus(_('Verifying PIN...'));
                            try {
                                const [pinStdout] = await this._indicator._send('pair_pin', deviceId, pin);
                                const pinRes = JSON.parse(pinStdout);
                                if (pinRes.credentials) {
                                    creds[protocol] = pinRes.credentials;
                                    resolve();
                                } else {
                                    reject(new Error('No credentials returned'));
                                }
                            } catch(e) {
                                reject(e);
                            }
                        }, () => {
                            reject(new Error('PIN cancelled'));
                        });
                    } else {
                        reject(new Error('Unexpected pair_begin response'));
                    }
                })
                .catch(reject);
        });
    }

    _promptPin(protocol, onSubmit, onCancel) {
        this._deviceList.destroy_all_children();
        
        const label = new St.Label({
            text: _('Enter PIN shown on Apple TV:\n(If no PIN appears, click Skip)'),
            style_class: 'appletv-device-name'
        });
        this._deviceList.add_child(label);
        
        const pinEntry = new St.Entry({
            hint_text: '1234',
            can_focus: true,
            style_class: 'appletv-text-entry'
        });
        this._deviceList.add_child(pinEntry);
        
        this.setButtons([
            {
                label: _('Skip'),
                action: () => onCancel(),
                key: Clutter.KEY_Escape,
            },
            {
                label: _('Submit'),
                action: () => onSubmit(pinEntry.get_text()),
                default: true,
            },
        ]);
        
        pinEntry.clutter_text.grab_key_focus();
    }

    _restoreButtons() {
        this.setButtons([
            {
                label: _('Scan'),
                action: () => this._scanDevices(),
            },
            {
                label: _('Close'),
                action: () => this.close(),
                key: Clutter.KEY_Escape,
            },
        ]);
    }

    async _selectDevice(deviceId) {
        try {
            await this._indicator._send('select_device', deviceId);
            this._indicator._selectDevice(deviceId);
            this._selectedId = deviceId;
            this.close();
        } catch (e) {
            this._setStatus(`Error: ${e}`);
        }
    }

    async _removeDevice(deviceId, deviceName) {
        this._setStatus(_('Removing\u2026'));
        try {
            await this._indicator._send('remove_device', deviceId);
            if (this._indicator._selectedId === deviceId) {
                this._indicator._selectedId = null;
            }
            await this._loadDevices();
            this._setStatus(_('%s removed.').format(deviceName));
        } catch (e) {
            this._setStatus(`Error: ${e}`);
        }
    }

    async _scanDevices() {
        if (this._scanning) return;
        this._scanning = true;
        this._setStatus(_('Scanning\u2026'));
        try {
            const [stdout] = await this._indicator._send('scan_devices');
            const res = JSON.parse(stdout);
            const all = res.devices || [];
            this._renderDevices(all);
            this._setStatus(_('Found %d device(s).').format(all.length));
        } catch (e) {
            this._setStatus(`${_('Scan error:')} ${e}`);
        } finally {
            this._scanning = false;
        }
    }

    _setStatus(msg) {
        this._statusLabel.text = msg;
        this._statusLabel.visible = !!msg;
    }

    close() {
        this._onClosed?.();
        super.close();
    }
});
