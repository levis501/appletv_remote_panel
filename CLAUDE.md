# Claude Instructions for Apple TV Remote Panel

## Project Overview

A GNOME Shell extension that controls Apple TVs over the local network. Two main components:

1. **Python Backend** (`atv_daemon.py`, `atv_control.py`, `atv_setup.py`): Uses `pyatv` to communicate with Apple TVs via MRP, Companion, and AirPlay protocols.
2. **GNOME Shell Extension** (`extension/`): GJS/JavaScript frontend providing a GNOME panel UI. Communicates with the backend via a persistent daemon process.

### Backend architecture: persistent daemon

The extension spawns `atv_daemon.py` once (on first `_send()` call) and keeps it alive for the session. The daemon maintains persistent pyatv connections per device, so button presses are fast (~50–150 ms) after the initial connection is established. Communication is newline-delimited JSON over stdin/stdout:

- Request:  `{"id": "1", "cmd": "play_pause", "args": ["<device_id>"]}`
- Response: `{"id": "1", "result": {}}` or `{"id": "1", "error": "message"}`

`atv_control.py` is kept for direct testing and debugging from the command line.

## Key Files

- `atv_daemon.py` — persistent daemon; maintains live pyatv connections; used by the extension at runtime
- `atv_control.py` — one-shot CLI tool for testing backend commands directly
- `atv_setup.py` — interactive device manager: scan/add/re-pair devices, remove devices
- `atv_color_fetcher.py` — one-shot script: fetches app icons from iTunes API, extracts dominant colour, writes `app_colors.json`
- `install.sh` — sets up venv, installs `pyatv`/`duckduckgo-search`/`Pillow`, deploys extension and scripts
- `extension/extension.js` — main extension entry point; `_send()` writes to daemon stdin
- `extension/appChooser.js`, `extension/appDialog.js` — UI subcomponents
- `extension/stylesheet.css` — extension styles
- `extension/metadata.json` — GNOME extension metadata
- `~/.config/appletv-remote/devices.json` — device credentials and config (not in repo)
- `~/.config/appletv-remote/app_colors.json` — cached app button colours (written by `atv_color_fetcher.py`)
- `~/.config/appletv-remote/apps.json` — favorites plus last seen full app list (used to prioritize icon fetching)

## Development Workflow

After editing **any** project file, re-run `./install.sh` before testing — changes are not reflected until installed.

```bash
./install.sh
```

Restart GNOME Shell to load extension changes:
- **X11:** `Alt+F2` → type `r` → Enter
- **Wayland:** Log out and back in, or use a nested session:
  ```bash
  dbus-run-session -- gnome-shell --nested --wayland
  ```

## Backend Development

- Add new commands to **both** `atv_daemon.py` (`_dispatch` method) and `atv_control.py` (`main` function) so they stay in sync
- `atv_daemon.py` uses `_respond(id, result=...)` / `_respond(id, error=...)`; `atv_control.py` uses `out()` / `die()`
- Test commands directly from the venv (uses `atv_control.py`, not the daemon):
  ```bash
  ~/.config/appletv-remote/venv/bin/python3 ~/.config/appletv-remote/atv_control.py status <device_id>
  ~/.config/appletv-remote/venv/bin/python3 ~/.config/appletv-remote/atv_control.py play_pause <device_id>
  ```
- Device IDs are in `~/.config/appletv-remote/devices.json` or via `atv_control.py list_devices` (instant, no scan). Use `atv_control.py scan` only to discover new unconfigured devices on the network.
- If auth fails, re-run setup:
  ```bash
  ~/.config/appletv-remote/venv/bin/python3 ~/.config/appletv-remote/atv_setup.py
  ```

## Frontend Development

- UI uses St (Shell Toolkit) widgets following GNOME Shell conventions
- Call backend via `this._send('command', ...args)` in `extension.js`
- Use `log()` for debugging — output appears in:
  ```bash
  journalctl /usr/bin/gnome-shell -f | grep -i appletv
  ```
- When building new UI components, mock `_send()` returns to avoid needing a real device
- App chooser grid uses `Clutter.FixedLayout` with manual tile positioning in
  `extension/appChooser.js` to avoid the CSS/layout timing race entirely. Tiles are positioned
  at exact pixel coordinates (50 x 50) in a 4-column grid, so `FlowLayout` preferred-size
  measurement never occurs. Long app names are wrapped to two lines before rendering.

## Adding New Features

1. Add the `pyatv` call in `atv_daemon.py` (`_dispatch` method) and mirror it in `atv_control.py`
2. Add the UI element in `extension/` and wire it to `_send()`
3. Update `install.sh` `pip install` commands if new Python packages are needed
4. Keep styling consistent with `stylesheet.css` and GNOME Shell guidelines

## Documentation Update Policy

Keep AI instruction files current after every significant change:

- **After completing a milestone or feature**: Update `CLAUDE.md`, `GEMINI.md`, and `.github/copilot-instructions.md` to reflect new architecture, key files, or workflows.
- **After fixing a bug**: Note any patterns or gotchas discovered.
- **After adding or removing files or directories**: Update the Key Files section.
- **After failing or passing tests, or identifying new constraints**: Record them so future sessions start with correct context.

## Pairing Notes

- `atv_setup.py` is an interactive loop: choose `[a]` to scan and add/re-pair, `[r]` to remove a device, `[q]` to quit. Existing devices not selected in a run are preserved.
- Fresh installs invoke `atv_setup.py --auto-add` so the initial scan immediately prompts for device selection.
- Pairing order: **MRP first** (required — enables all remote control and metadata), then **Companion** (optional, recommended for tvOS 15+).
- MRP is required for remote control and most metadata.
- Back up `devices.json` before testing pairing changes.
