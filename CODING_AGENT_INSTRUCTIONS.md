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
