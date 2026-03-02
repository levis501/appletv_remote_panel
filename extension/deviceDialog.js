
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';


const FRUIT_OPTIONS = [
    { id: 'lemon',      label: 'Lemon' },
    { id: 'cherry',     label: 'Cherry' },
    { id: 'strawberry', label: 'Strawberry' },
    { id: 'pineapple',  label: 'Pineapple' },
    { id: 'grape',      label: 'Grape' },
    { id: 'watermelon', label: 'Watermelon' },
    { id: 'banana',     label: 'Banana' },
    { id: 'peach',      label: 'Peach' },
    { id: 'kiwi',       label: 'Kiwi' },
    { id: 'orange',     label: 'Orange' },
];


export const DeviceDialog = GObject.registerClass(
class DeviceDialog extends ModalDialog.ModalDialog {
    _init(indicator, onClosed) {
        super._init({
            styleClass: 'fruittv-device-dialog',
            destroyOnClose: true,
        });
        this._indicator = indicator;
        this._onClosed = onClosed;
        this._scanning = false;
        this._selectedId = indicator._selectedId;
        this._fruitBtns = new Map();

        this._buildLayout();
        this._loadDevices();
    }

    _buildLayout() {
        const title = new St.Label({
            text: _('Fruit TV Devices'),
            style_class: 'fruittv-device-dialog-title',
        });
        this.contentLayout.add_child(title);

        // ── Fruit picker ───────────────────────────────────────────────
        this._buildFruitPicker();

        // ── Device list ────────────────────────────────────────────────
        this._deviceList = new St.BoxLayout({
            vertical: true,
            style_class: 'fruittv-device-list',
        });

        const scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            style_class: 'fruittv-device-scroll',
            x_expand: true,
        });
        scroll.add_child(this._deviceList);
        this.contentLayout.add_child(scroll);

        this._statusLabel = new St.Label({
            text: '',
            style_class: 'fruittv-device-status',
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

    _buildFruitPicker() {
        const pickerLabel = new St.Label({
            text: _('Logo Fruit:'),
            style_class: 'fruittv-device-name',
        });
        this.contentLayout.add_child(pickerLabel);

        const row = new St.BoxLayout({
            style_class: 'fruittv-device-fruit-row',
            x_expand: true,
        });
        this.contentLayout.add_child(row);

        const extensionPath = this._indicator._extension.path;
        const currentFruit = this._indicator._extension.getLogoFruit();

        for (const fruit of FRUIT_OPTIONS) {
            const iconFile = Gio.File.new_for_path(
                `${extensionPath}/icons/fruits/${fruit.id}-symbolic.svg`
            );
            const icon = new St.Icon({
                gicon: new Gio.FileIcon({ file: iconFile }),
                icon_size: 18,
            });

            const btn = new St.Button({
                style_class: 'fruittv-device-fruit-btn',
                can_focus: true,
                reactive: true,
                child: icon,
            });

            if (fruit.id === currentFruit) {
                btn.add_style_class_name('fruittv-device-fruit-active');
            }

            btn.connect('clicked', () => this._selectFruit(fruit.id));
            row.add_child(btn);
            this._fruitBtns.set(fruit.id, btn);
        }
    }

    _selectFruit(fruitId) {
        // Update highlight on all buttons
        for (const [id, btn] of this._fruitBtns) {
            if (id === fruitId) {
                btn.add_style_class_name('fruittv-device-fruit-active');
            } else {
                btn.remove_style_class_name('fruittv-device-fruit-active');
            }
        }
        // Propagate to indicator (saves + updates panel icon + refreshes TV button)
        this._indicator._setLogoFruit(fruitId);
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
                style_class: 'fruittv-device-none-label',
            }));
            return;
        }
        for (const device of devices) {
            this._deviceList.add_child(this._makeDeviceRow(device));
        }
    }

    _makeDeviceRow(device) {
        const row = new St.BoxLayout({
            style_class: 'fruittv-device-row',
            x_expand: true,
        });

        const nameLabel = new St.Label({
            text: device.name || device.id,
            style_class: `fruittv-device-name${device.known === false ? ' fruittv-device-unregistered' : ''}`,
            x_expand: true,
        });
        row.add_child(nameLabel);

        if (device.known === false) {
            const setupBtn = new St.Button({
                label: _('Setup'),
                style_class: 'fruittv-device-btn',
                can_focus: true,
            });
            setupBtn.connect('clicked', () => this._setupDevice(device.id, device.address, device.name));
            row.add_child(setupBtn);
        } else {
            // Only show Select button if this device is not currently selected
            if (device.id !== this._selectedId) {
                const selectBtn = new St.Button({
                    label: _('Select'),
                    style_class: 'fruittv-device-btn',
                    can_focus: true,
                });
                selectBtn.connect('clicked', () => this._selectDevice(device.id));
                row.add_child(selectBtn);
            }

            const removeBtn = new St.Button({
                label: _('Remove'),
                style_class: 'fruittv-device-btn fruittv-device-remove-btn',
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
            log(`FruitTV-Remote MRP pairing failed: ${e}`);
        }

        let companionSuccess = false;
        try {
            await this._pairProtocol(deviceId, address, 'companion', creds);
            companionSuccess = true;
        } catch (e) {
            log(`FruitTV-Remote Companion pairing failed: ${e}`);
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
            text: _('Enter PIN shown on Fruit TV:\n(If no PIN appears, click Skip)'),
            style_class: 'fruittv-device-name'
        });
        this._deviceList.add_child(label);

        const pinEntry = new St.Entry({
            hint_text: '1234',
            can_focus: true,
            style_class: 'fruittv-text-entry'
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
