# Coding Agent Instructions for Apple TV Remote Panel

This is the canonical instruction file for coding agents and human contributors working in this repository.

If guidance in older files conflicts with this file, follow this file.

## 1) Architecture Overview

The project is a GNOME Shell remote for Apple TV devices.

- Backend: Python scripts in `scripts/` using `pyatv`.
- Frontend: GNOME Shell extension code in `extension/` (GJS).

### Runtime model (current)

- `extension/extension.js` communicates with `scripts/atv_daemon.py` using newline-delimited JSON over stdin/stdout.
- The daemon is persistent within a shell session and keeps live device connections cached for low-latency controls.

Example protocol:

- Request: `{"id": "1", "cmd": "play_pause", "args": ["<device_id>"]}`
- Success response: `{"id": "1", "result": {}}`
- Error response: `{"id": "1", "error": "message"}`

### Supporting CLIs

- `scripts/atv_control.py` is a one-shot command tool for direct testing/debugging.
- `scripts/atv_setup.py` handles scanning, pairing, and saved device credentials.

## 2) Project Index

Use this index as a quick map for where to make changes.

### Top-level

- `install.sh`: Main deploy script. Creates/updates `~/.config/appletv-remote/venv`, installs Python deps, copies scripts and extension files.
- `generate_manual.py`: Documentation/manual generation helper.
- `tests/`: Test and screenshot assets.
- `docs/`: Design notes, fixes, known issues, and feature specs.

### Python backend (`scripts/`)

- `scripts/atv_daemon.py`: Persistent Apple TV command daemon used by extension runtime.
- `scripts/atv_control.py`: One-shot command runner for manual testing from terminal.
- `scripts/atv_setup.py`: Interactive setup/pairing manager for devices.
- `scripts/atv_color_fetcher.py`: Fetches app icons and writes extracted colors.
- `scripts/ftv_daemon.py`, `scripts/ftv_control.py`, `scripts/ftv_setup.py`, `scripts/ftv_color_fetcher.py`: Fire TV-related helpers.
- `scripts/test_pyatv_pair.py`: Pairing-oriented test script.

### Primary GNOME extension (`extension/`)

- `extension/extension.js`: Main extension entry point, panel UI orchestration, backend request dispatch.
- `extension/appChooser.js`: App chooser UI. Uses `Clutter.FixedLayout` + manual tile placement.
- `extension/appDialog.js`: App dialog component(s).
- `extension/deviceDialog.js`: Device selection/management UI component(s).
- `extension/stylesheet.css`: Styling for the main extension.
- `extension/metadata.json`: GNOME extension metadata.
- `extension/icons/`: Icon assets (apps, decorative assets).

### Variant extensions

- `extension_mouse/`: Mouse-focused variant extension implementation.
- `extension_playpause/`: Play/pause-focused variant extension implementation.

### Documentation (`docs/`)

- `docs/ISSUES_*.md`: Issue logs and debugging notes.
- `docs/NEW_FEATURE_*.md`: Feature specs and plans.
- `docs/*.md` (others): Focused notes for behavior, layout, button sizing, icon strategy, and UX investigations.

### Runtime files outside repo

- `~/.config/appletv-remote/devices.json`: Device credentials/config.
- `~/.config/appletv-remote/apps.json`: Favorites and last-seen app list.
- `~/.config/appletv-remote/app_colors.json`: Cached app color mapping.

## 3) Development Workflow

After editing any project file, rerun:

```bash
./install.sh
```

Then reload GNOME Shell:

- X11: `Alt+F2`, then `r`.
- Wayland: log out/in, or run nested shell (`dbus-run-session -- gnome-shell --nested --wayland`).

Important: editing files in this repo does not affect the live extension until `install.sh` copies them into runtime locations.

## 4) Backend Guidelines

- When adding a new Apple TV command, update both:
  - `scripts/atv_daemon.py` dispatcher.
  - `scripts/atv_control.py` command handler.
- Keep command names and argument order aligned between daemon and CLI.
- Use JSON success/error helpers consistently (`_respond(...)` in daemon, `out()`/`die()` in CLI).
- Pairing order policy: MRP first (required), Companion optional but recommended (tvOS 15+).

Manual command checks:

```bash
~/.config/appletv-remote/venv/bin/python3 ~/.config/appletv-remote/atv_control.py list_devices
~/.config/appletv-remote/venv/bin/python3 ~/.config/appletv-remote/atv_control.py status <device_id>
~/.config/appletv-remote/venv/bin/python3 ~/.config/appletv-remote/atv_control.py play_pause <device_id>
```

If auth breaks, rerun setup:

```bash
~/.config/appletv-remote/venv/bin/python3 ~/.config/appletv-remote/atv_setup.py
```

## 5) Frontend Guidelines

- Use St widgets and GNOME Shell conventions.
- Route backend calls via `_send('command', ...args)` in `extension/extension.js`.
- For UI work that does not require live devices, mock backend responses for faster iteration.

### UI gotcha: async layout race

- Avoid async population during dialog layout in scene-graph measurement paths.
- In app chooser UI, prefer `Clutter.FixedLayout` with explicit tile coordinates.
- Current app chooser behavior:
  - 4 columns.
  - 50 x 50 tiles.
  - Wrapped long app names to two lines.

## 6) Debugging

GNOME Shell logs:

```bash
journalctl /usr/bin/gnome-shell -f | grep -i appletv
```

Use logs to inspect frontend exceptions and backend stderr surfaced by subprocess/daemon plumbing.

When diagnosing command failures:

1. Verify `list_devices` and credentials.
2. Run the equivalent command via `atv_control.py` directly.
3. Re-pair with `atv_setup.py` if credentials are stale.

## 7) Feature Implementation Checklist

1. Decide if change belongs in backend, frontend, or both.
2. Add/modify backend command path (`atv_daemon.py` and `atv_control.py`).
3. Wire frontend interaction in `extension/`.
4. Update `install.sh` if new Python dependencies are required.
5. Reinstall via `./install.sh` and validate behavior with logs/tests.

## 8) Documentation Maintenance Policy

After significant changes (features, bug fixes, architecture changes, file moves), update this file so future agents and contributors start from accurate context.

Examples of updates that require refreshing this file:

- New or removed key runtime files/directories.
- Changes to backend communication model.
- New setup/pairing constraints.
- New recurring debugging patterns or known gotchas.

## 9) Quick Reference Commands

```bash
# Install/deploy local repo changes
./install.sh

# Follow extension logs
journalctl /usr/bin/gnome-shell -f | grep -i appletv

# Test backend quickly
~/.config/appletv-remote/venv/bin/python3 ~/.config/appletv-remote/atv_control.py list_devices
```

---

## 10) Symbol & Concept Index

Use this index to quickly locate any concept, class, function, command, or CSS selector in the project.

---

### 10.1 Daemon Command Strings (`"cmd"` values in JSON protocol)

These are valid values for the `"cmd"` field in requests sent to `atv_daemon.py`.

#### Config / device management (no live connection required)

| Command | Description | Daemon dispatcher line |
|---|---|---|
| `"list_devices"` | Return all saved devices | `atv_daemon.py` ~L145 |
| `"get_config_value"` | Read a per-device config key | `atv_daemon.py` ~L155 |
| `"set_config_value"` | Write a per-device config key | `atv_daemon.py` ~L164 |
| `"select_device"` | Mark a device as selected in config | `atv_daemon.py` ~L177 |
| `"remove_device"` | Delete a device from config | `atv_daemon.py` ~L185 |
| `"scan_devices"` | Discover devices on the network | `atv_daemon.py` ~L198 |
| `"pair_begin"` | Start pairing for a protocol | `atv_daemon.py` ~L222 |
| `"pair_pin"` | Submit PIN during pairing | `atv_daemon.py` ~L254 |
| `"pair_save"` | Persist credentials from pairing | `atv_daemon.py` ~L281 |

#### Live-connection commands (require a paired, reachable device)

| Command | Description | Daemon dispatcher line |
|---|---|---|
| `"power_state"` | Query current power state | `atv_daemon.py` ~L322 |
| `"power_on"` | Send power-on remote key | `atv_daemon.py` ~L421 block |
| `"power_off"` | Send power-off remote key | `atv_daemon.py` ~L421 block |
| `"get_volume"` | Read current volume level | `atv_daemon.py` ~L327 |
| `"set_volume"` | Set absolute volume level | `atv_daemon.py` ~L332 |
| `"volume_mute"` | Toggle mute | `atv_daemon.py` ~L345 |
| `"get_metadata"` | Fetch now-playing metadata | `atv_daemon.py` ~L357 |
| `"get_artwork"` | Fetch current artwork bytes | `atv_daemon.py` ~L385 |
| `"list_apps"` | List installed iOS/tvOS apps | `atv_daemon.py` ~L396 |
| `"launch_app"` | Launch an app by bundle ID | `atv_daemon.py` ~L405 |
| `"keyboard_set"` | Type text into focused text field | `atv_daemon.py` ~L413 |

#### Remote control keys (handled by `REMOTE_COMMANDS` set)

`"play_pause"`, `"stop"`, `"volume_up"`, `"volume_down"`, `"skip_next"`, `"skip_prev"`, `"next_track"`, `"prev_track"`, `"select"`, `"select_hold"`, `"up"`, `"down"`, `"left"`, `"right"`, `"menu"`, `"home"`, `"top_menu"`

All dispatch via the shared remote-key path in `atv_daemon.py` ~L421.

---

### 10.2 Frontend Classes (GJS / GNOME Shell)

| Class | File | Approx. line | Extends | Purpose |
|---|---|---|---|---|
| `FruitTVIndicator` | `extension/extension.js` | 44 | `PanelMenu.Button` | Panel button + full remote UI; owns daemon process |
| `FruitTVRemoteExtension` | `extension/extension.js` | ~733 | `Extension` | GNOME extension entry point; owns config I/O and color cache |
| `AppChooser` | `extension/appChooser.js` | ~215 | `St.BoxLayout` | Full-screen app grid; uses `Clutter.FixedLayout` |
| `AppTile` | `extension/appChooser.js` | 79 | `St.Button` | Single app tile inside the app chooser |
| `AppDialog` | `extension/appDialog.js` | 11 | `ModalDialog.ModalDialog` | Modal dialog wrapping `AppChooser` |
| `DeviceDialog` | `extension/deviceDialog.js` | 102 | `ModalDialog.ModalDialog` | Device list, pairing flow, fruit-logo picker |
| `DeviceDetailsDialog` | `extension/deviceDialog.js` | 26 | `ModalDialog.ModalDialog` | Read-only device detail popup (not exported) |

---

### 10.3 Key Methods — `FruitTVIndicator` (`extension/extension.js`)

| Method | Approx. line | What it does |
|---|---|---|
| `_init(extension)` | 45 | Constructor; creates panel icon and all sub-widgets |
| `_buildMenu()` | 112 | Assembles the drop-down menu containing the remote graphic |
| `_remoteControls()` | 130 | Lays out invisible hit-region buttons over the remote PNG |
| `_refreshAppButtons()` | 262 | Re-renders the 3-slot quick-app strip at the bottom |
| `_makeQuickAppButton(app)` | 290 | Creates one quick-app button (colored, icon optional) |
| `_openDeviceDialog()` | 418 | Opens `DeviceDialog` |
| `_loadDevices()` | 427 | Sends `list_devices` and populates `_devices` map |
| `_validateFavorites()` | 450 | Ensures favorites exist in known apps; prunes stale entries |
| `_setRemoteReady(isReady)` | 481 | Enables/disables remote controls after device selection |
| `_togglePower()` | 487 | Sends `power_on` or `power_off` based on `_powerStates` |
| `_openAppSelector()` | 503 | Opens `AppDialog` for the selected device |
| `_updatePowerStatus(deviceId, forceState)` | 553 | Refreshes power LED and state cache |
| `_selectDevice(deviceId)` | 575 | Switches active device; loads favorites; starts polling |
| `_startPolling()` / `_stopPolling()` | 582/589 | Manages the metadata poll timer |
| `_pollMetadata()` | 595 | Fires `get_metadata` on poll interval |
| `_updateMetadata(r)` | 605 | Applies metadata response to title label and app buttons |
| `_ensureDaemon()` | 619 | Spawns `atv_daemon.py` subprocess if not running |
| `_readLoop()` | 641 | Async loop reading JSON lines from daemon stdout |
| `_handleResponse(line)` | 654 | Parses a JSON response and resolves the matching Promise |
| `_send(command, ...extraArgs)` | 703 | Sends a JSON command; returns a Promise resolved on response |
| `destroy()` | 720 | Cleans up timers, daemon process, and widgets |

---

### 10.4 Key Methods — `FruitTVRemoteExtension` (`extension/extension.js`)

| Method | Approx. line | What it does |
|---|---|---|
| `enable()` / `disable()` | 736/748 | GNOME lifecycle hooks |
| `_loadLogoFruit()` / `_saveLogoFruit(fruit)` | 761/772 | Persists the decorative logo fruit selection |
| `getAppColor(appId)` | 804 | Returns cached `{bg, text}` for an app, or `null` |
| `hasAppBeenProcessed(appId)` | 808 | Returns true if color fetch was attempted (even if null) |
| `_watchColorFile()` | 812 | Sets up `Gio.FileMonitor` to reload colors on file change |
| `_startColorFetcher()` | 823 | Launches `atv_color_fetcher.py` as a background subprocess |
| `_readAppsConfig()` / `_saveAppsConfig(...)` | 839/854 | I/O for `apps.json` (favorites + known apps) |
| `getFavoriteApps(_deviceId)` | 874 | Returns array of favorite bundle IDs |
| `setAppFavorite(_deviceId, app, isFavorite)` | 878 | Adds/removes an app from favorites and persists |
| `getAppIconSync(app)` | 898 | Returns a `St.Icon` synchronously from cached icon file |
| `getApps(deviceId)` | 917 | Sends `list_apps`; merges result with saved apps list |
| `sendCommand(command, ...args)` | 935 | Public surface for `DeviceDialog` to call `_send` |

---

### 10.5 Key Methods — Python Backend

#### `ATVDaemon` (`scripts/atv_daemon.py`)

| Method | Approx. line | What it does |
|---|---|---|
| `__init__()` | 46 | Sets up connection dict, lock dict, and pairing state |
| `_respond(id_, *, result, error)` | 53 | Writes one JSON response line to stdout |
| `_build_config(entry)` | 65 | Builds a `pyatv.conf.AppleTV` from a saved device entry |
| `_connect(device_id)` | 82 | Opens a live `pyatv` connection and stores it |
| `_get_connection(device_id, reconnect=False)` | 93 | Returns cached connection, optionally reconnecting |
| `_with_retry(device_id, fn)` | 108 | Runs `fn(atv)`, retries once on connection error |
| `_dispatch(cmd, args)` | 117 | The main command switch; routes each cmd string |
| `_execute(msg)` | 449 | Parses a JSON request line and calls `_dispatch` |
| `run()` | 457 | Async entry point; reads stdin in a loop |

#### `scripts/atv_control.py` — top-level helpers

| Symbol | Approx. line | What it does |
|---|---|---|
| `out(obj)` | 62 | Prints JSON result and exits 0 |
| `die(msg)` | 67 | Prints JSON error and exits 1 |
| `build_config(entry)` | 74 | Same as daemon's `_build_config`; builds `pyatv.conf.AppleTV` |
| `cmd_scan_devices()` | 133 | Network scan, returns device list |
| `cmd_remote(entry, command)` | 272 | Fires any remote-key command by name |
| `main()` | 329 | CLI argument router |

#### `scripts/atv_color_fetcher.py` — key functions

| Symbol | Approx. line | What it does |
|---|---|---|
| `extract_dominant_color(image_data)` | 88 | K-means clustering to pull dominant color from icon bytes |
| `best_text_color(bg_rgb)` | 82 | Returns `#000000` or `#ffffff` based on contrast ratio |
| `search_icon_url(app_name, app_id)` | 167 | Queries iTunes Search API for a 100×100 icon URL |
| `fetch_colors_for_app(app)` | 229 | End-to-end: icon download → color extraction → save |
| `main()` | 258 | Iterates apps that need processing and runs fetcher |

---

### 10.6 Key Constants

| Constant | Value | File | Line |
|---|---|---|---|
| `TV_APP_ID` | `'com.apple.TVWatchList'` | `extension.js`, `appChooser.js` | 41 / 18 |
| `APP_COLOR_CLASSES` | Map of 6 bundle IDs → CSS class name | `extension.js`, `appChooser.js` | 31 / 8 |
| `APP_BTN_COLS` | `[32, 88, 144]` (x positions of 3 quick-app slots) | `extension.js` | 19 |
| `APP_BTN_W` / `APP_BTN_H` | `50` / `50` | `extension.js` | 20–21 |
| `APP_BTN_ROW_H` | `APP_BTN_H + 6` | `extension.js` | 22 |
| `APP_BTNS_Y` | `578` (y offset into remote graphic for quick-app strip) | `extension.js` | 17 |
| `TILES_PER_ROW` | `4` | `appChooser.js` | 22 |
| `APP_TILE_WIDTH` / `APP_TILE_HEIGHT` | `50` / `50` | `appChooser.js` | 20–21 |
| `COL_SPACING` / `ROW_SPACING` | `12` / `12` | `appChooser.js` | 23–24 |
| `START_X` / `START_Y` | `12` / `12` | `appChooser.js` | 25–26 |
| `MIN_WRAP_CHARS` | `9` (threshold for two-line app name wrapping) | `appChooser.js` | 27 |
| `FRUIT_OPTIONS` | 10-item array of `{id, label}` for logo picker | `deviceDialog.js` | 10 |
| `CONFIG_PATH` | `~/.config/appletv-remote/devices.json` | `atv_daemon.py`, `atv_control.py` | 20 / 24 |
| `REQUEST_DELAY` | `1.5` seconds between icon fetches | `atv_color_fetcher.py` | 33 |

---

### 10.7 CSS Class Names (stylesheet.css)

Classes applied via `style_class` or `add_style_class_name` across the extension:

#### Remote panel
| Class | Usage |
|---|---|
| `fruittv-remote-graphic` | Outer container holding the remote image |
| `fruittv-hit-btn` | Invisible hit-region button overlaid on remote graphic |
| `fruittv-hit-circle` | Circular variant of hit-region button (D-pad center) |
| `fruittv-remote-light` | Power/status LED indicator widget |
| `fruittv-remote-item` | Generic menu item in the remote panel |
| `fruittv-text-entry` | Keyboard text entry field |

#### App buttons
| Class | Usage |
|---|---|
| `fruittv-quick-app-btn` | Quick-app button in the 3-slot strip (and app chooser tiles) |
| `fruittv-quick-app-btn-with-icon` | Variant when a cached icon is shown |
| `fruittv-quick-app-label` | Text label inside an app button |
| `fruittv-app-fruit-icon` | Fallback fruit emoji icon in an app button |
| `fruittv-app-active` | Highlight applied to the currently-running app |
| `fruittv-app-chooser-btn` | App tile variant inside `AppChooser` |
| `app-chooser` | Outer `AppChooser` container |
| `app-chooser-grid` | Inner fixed-layout grid container |

#### Per-app color classes (set via `APP_COLOR_CLASSES` map)
`fruittv-app-color-tv`, `fruittv-app-color-music`, `fruittv-app-color-arcade`, `fruittv-app-color-photos`, `fruittv-app-color-settings`, `fruittv-app-color-fitness`

#### Device dialog
| Class | Usage |
|---|---|
| `fruittv-device-dialog` | Outer device dialog |
| `fruittv-device-dialog-title` | Title label |
| `fruittv-device-list` | Scrollable device list container |
| `fruittv-device-scroll` | ScrollView wrapping device list |
| `fruittv-device-row` | One device row (name + action buttons) |
| `fruittv-device-name` | Device name label in a row |
| `fruittv-device-unregistered` | Style applied when device lacks credentials |
| `fruittv-device-btn` | Connect / Details button |
| `fruittv-device-remove-btn` | Remove button in a device row |
| `fruittv-device-none-label` | Label shown when no devices exist |
| `fruittv-device-status` | Status message label at bottom of dialog |
| `fruittv-device-fruit-row` | Row of fruit-logo picker buttons |
| `fruittv-device-fruit-btn` | Individual fruit picker button |
| `fruittv-device-fruit-active` | Currently-selected fruit |
| `fruittv-device-details-dialog` | Device details popup |
| `fruittv-device-details-list` | List inside device details popup |
| `fruittv-device-details-row` | One key/value row in details list |
| `fruittv-device-details-key` | Key label in a details row |
| `fruittv-device-details-value` | Value label in a details row |

#### App dialog
| Class | Usage |
|---|---|
| `app-dialog` | Outer `AppDialog` |
| `app-dialog-title` | Dialog title label |
| `app-dialog-scroll-view` | ScrollView in app dialog |
| `app-dialog-ok-btn` | Close / OK button |

---

### 10.8 Concept Glossary

| Concept | Where to look | Notes |
|---|---|---|
| **Logo fruit** | `FruitTVRemoteExtension._loadLogoFruit`, `deviceDialog.js FRUIT_OPTIONS` | Decorative panel icon choice per user; persisted in a settings file |
| **Favorites** | `FruitTVRemoteExtension.getFavoriteApps`, `setAppFavorite`, `apps.json` | Subset of known apps shown in the 3-slot quick-app strip |
| **Quick-app strip** | `FruitTVIndicator._refreshAppButtons`, constants `APP_BTN_COLS/APP_BTNS_Y` | 3 fixed-position buttons at the bottom of the remote graphic |
| **App chooser** | `AppChooser`, `AppDialog`, `AppTile` | Full-screen 4-column grid; opened via `_openAppSelector` |
| **App colors** | `atv_color_fetcher.py`, `app_colors.json`, `FruitTVRemoteExtension.getAppColor` | Dominant bg+text color pair extracted from iTMS icon for each app |
| **Color monitor** | `FruitTVRemoteExtension._watchColorFile` | `Gio.FileMonitor` on `app_colors.json`; triggers CSS class refresh |
| **Daemon** | `atv_daemon.py`, `FruitTVIndicator._ensureDaemon/_readLoop/_send` | Persistent subprocess; one per shell session; commands flow via newline-delimited JSON on stdin/stdout |
| **Pairing flow** | `deviceDialog.js _setupDevice/_pairProtocol/_promptPin`, daemon `pair_begin/pair_pin/pair_save` | MRP required first; Companion optional (tvOS 15+) |
| **Metadata polling** | `FruitTVIndicator._startPolling/_pollMetadata/_updateMetadata` | Timer-based `get_metadata` calls; updates title label and active-app highlight |
| **Power states** | `FruitTVIndicator._powerStates` (Map), `_togglePower`, `_updatePowerStatus` | Cached per device; drives power LED and on/off command selection |
| **Hit regions** | `FruitTVIndicator._remoteControls`, CSS `fruittv-hit-btn/fruittv-hit-circle` | Transparent buttons positioned with `Clutter.FixedLayout` over a PNG background |
| **`wrapAppName`** | `appChooser.js` line 29 | Inserts newline in app names longer than `MIN_WRAP_CHARS` so tile label fits in 2 lines |
| **`_send` protocol** | `FruitTVIndicator._send` | Returns a `Promise`; keyed by auto-incrementing `_cmdId`; resolved by `_handleResponse` |
| **`device_details` command** | `deviceDialog.js _showDeviceDetails` | Called by the UI but **not yet implemented** in `atv_daemon.py` — known gap |
| **Fire TV variant** | `scripts/ftv_*.py` | Parallel backend scripts for Amazon Fire TV devices; share the same pattern as ATV scripts |
