# Claude Instructions for Apple TV Remote Panel

## Project Overview

A GNOME Shell extension that controls Apple TVs over the local network. Two main components:

1. **Python Backend** (`atv_control.py`, `atv_setup.py`): Uses `pyatv` to communicate with Apple TVs via MRP, Companion, and AirPlay protocols. Outputs JSON to stdout/stderr.
2. **GNOME Shell Extension** (`extension/`): GJS/JavaScript frontend providing a GNOME panel UI. Invokes the Python backend via `Gio.Subprocess` and parses JSON responses.

## Key Files

- `atv_control.py` — backend commands (scan, status, play/pause, volume, app management, etc.)
- `atv_setup.py` — device pairing and credential setup
- `install.sh` — sets up venv, installs `pyatv`, deploys extension and scripts
- `extension/extension.js` — main extension entry point; `_send()` dispatches backend commands
- `extension/appChooser.js`, `extension/appDialog.js` — UI subcomponents
- `extension/stylesheet.css` — extension styles
- `extension/metadata.json` — GNOME extension metadata
- `~/.config/appletv-remote/devices.json` — device credentials and config (not in repo)

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

- Add new commands as handlers in `atv_control.py` using `sys.argv` parsing
- Use `out()` for JSON success output, `die()` for JSON error output
- Test backend commands directly from the venv:
  ```bash
  ~/.config/appletv-remote/venv/bin/python3 ~/.config/appletv-remote/atv_control.py status <device_id>
  ~/.config/appletv-remote/venv/bin/python3 ~/.config/appletv-remote/atv_control.py play_pause <device_id>
  ```
- Device IDs are in `~/.config/appletv-remote/devices.json` or via `atv_control.py scan`
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

## Adding New Features

1. Add the `pyatv` call in `atv_control.py` (accepts args via `sys.argv`, returns JSON)
2. Add the UI element in `extension/` and wire it to `_send()`
3. Update `install.sh` `pip install` commands if new Python packages are needed
4. Keep styling consistent with `stylesheet.css` and GNOME Shell guidelines

## Pairing Notes

- Setup tries Companion protocol first (tvOS 15+), then falls back to MRP
- MRP is required for remote control and most metadata
- Back up `devices.json` before testing pairing changes
