# Gemini Development Guidelines for Apple TV Remote Panel

This document provides context and guidelines for debugging and adding features to the Apple TV Remote Panel GNOME Shell extension.

## Architecture Overview

The project is split into two main components:
1.  **Python Backend (`atv_control.py`, `atv_setup.py`):** Uses the `pyatv` library to communicate with Apple TVs over the local network via MRP, Companion, and AirPlay protocols. It outputs responses in JSON format.
2.  **GNOME Shell Extension (`extension/`):** A frontend written in GJS (GNOME JavaScript) that provides a UI in the GNOME panel. It interacts with the Apple TV by executing `atv_control.py` as a subprocess (`Gio.Subprocess`) and parsing the JSON output.

### Installation & Deployment Lifecycle
- `install.sh` creates a Python virtual environment at `~/.config/appletv-remote/venv`, installs `pyatv`, and copies the python scripts.
- On fresh installs, `install.sh` runs `atv_setup.py --auto-add` so the initial scan immediately prompts for device selection.
- The GNOME extension is installed to `~/.local/share/gnome-shell/extensions/appletv-remote@local`.
- **Important:** When developing, changes made in the local repository (e.g., `/home/levis/Development/appletv_remote_panel`) are *not* automatically reflected. You must re-run `./install.sh` to copy the updated scripts and extension files to their respective run locations.

## Debugging Guide

### 1. GNOME Shell Extension Issues
If the extension is failing to load, crashing, or throwing UI errors:
- **View Logs:** Monitor the GNOME Shell journal logs. This is the primary way to see errors from the JavaScript side or errors thrown when executing the Python helper.
  ```bash
  journalctl /usr/bin/gnome-shell -f | grep -i appletv
  ```
- **Restarting the Shell:** After running `./install.sh` to apply extension changes, you must restart GNOME Shell:
  - **X11:** Press `Alt+F2`, type `r`, and press `Enter`.
  - **Wayland:** You must log out and log back in, or use a nested session for testing (`dbus-run-session -- gnome-shell --nested --wayland`).
- **Debugging Subprocesses:** The extension uses `Gio.Subprocess` in `extension.js` (`_send()` method). If commands fail, check the stderr output logged via the `log()` function, which will appear in `journalctl`.
- **App chooser sizing race:** `extension/appChooser.js` uses `Clutter.FixedLayout` with
  manual tile positioning (x/y coordinates calculated per row/column). Tiles are 50 x 50
  in a 4-column grid, and long app names are wrapped to two lines before rendering. This
  bypasses `FlowLayout` preferred-size measurement entirely.

### 2. Python Backend & `pyatv` Issues
If the UI works but commands (play, pause, volume) fail, or metadata isn't updating, the issue is likely in the Python backend or pairing.
- **Test Backend Manually:** Bypass the GNOME extension and run the python helper directly to isolate issues.
  ```bash
  # Check status
  ~/.config/appletv-remote/venv/bin/python3 ~/.config/appletv-remote/atv_control.py status <device_id>
  
  # Send a remote command
  ~/.config/appletv-remote/venv/bin/python3 ~/.config/appletv-remote/atv_control.py play_pause <device_id>
  ```
  *(You can find `<device_id>` in `~/.config/appletv-remote/devices.json` or via `atv_control.py list_devices`)*
- **Configuration & Pairing:** Device configuration and credentials are saved in `~/.config/appletv-remote/devices.json`.
  - The setup tool now pairs **MRP first** (required for all remote control and metadata), then offers **Companion** pairing as an optional step (recommended for tvOS 15+).
  - If authentication fails, the credentials might have expired or the Apple TV was reset. Re-run setup to generate new credentials:
    ```bash
    ~/.config/appletv-remote/venv/bin/python3 ~/.config/appletv-remote/atv_setup.py
    ```
  - Note: MRP protocol is required for remote control and most metadata.

## Documentation Update Policy

Keep AI instruction files current after every significant change:

- **After completing a milestone or feature**: Update `CLAUDE.md`, `GEMINI.md`, and `.github/copilot-instructions.md` to reflect new architecture, key files, or workflows.
- **After fixing a bug**: Note any patterns or gotchas discovered.
- **After adding or removing files or directories**: Update the relevant sections.
- **After failing or passing tests, or identifying new constraints**: Record them so future sessions start with correct context.

## Notes

- `apps.json` stores favorites plus the last seen full app list (written when the app list is fetched). The icon fetcher prioritizes favorites, then processes the remaining apps in alphabetical order.

## Feature Update Guidelines

When implementing new features, consider the boundary between the JS frontend and the Python backend.

1.  **Adding a New Command/Feature:**
    *   **Backend (`atv_control.py`):** Add the corresponding `pyatv` call. Ensure it accepts necessary arguments via `sys.argv` and outputs the result using the `out()` (JSON success) or `die()` (JSON error) functions.
    *   **Frontend (`extension.js` / UI components):** Add the UI element. Connect its event to call the `this._send('your_new_command', ...args)` method. Handle the returned JSON payload.
2.  **Modifying UI:** Edit the files in `extension/` (e.g., `extension.js`, `stylesheet.css`). Remember to follow GNOME Shell styling conventions and use St (Shell Toolkit) widgets.
3.  **Dependencies:** If the new feature requires a new Python package, update the `pip install` commands inside `install.sh`.
4.  **Mocking for UI Dev:** If you are building UI components (like the upcoming App Management logic mentioned in `extension.js`), you can temporarily mock the returns in the `_send()` method or specific extension methods to avoid needing a real Apple TV connection during initial styling.
