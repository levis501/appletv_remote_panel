# Copilot Instructions for Apple TV Remote Panel

These instructions help GitHub Copilot ("the assistant") provide useful, context-aware suggestions and responses when working on the Apple TV Remote Panel project.

## Project Overview
The workspace contains:

- `atv_control.py` & `atv_setup.py`: Python backend using `pyatv` to control Apple TVs and output JSON.
- GNOME Shell extension in `extension/` (GJS/JavaScript) providing panel UI.
- `install.sh` for setting up the environment and copying files to deployment locations.

## Development Guidelines

### Python Backend

- New functionality should be added as command handlers in `atv_control.py`. Use `sys.argv` parsing and the provided `out()`/`die()` helpers for JSON.
- For setup or pairing tasks, modify `atv_setup.py` accordingly.
- Unit tests for new logic should be placed in a separate test file if appropriate.

### GNOME Shell Extension

- The UI code lives in `extension/`:
  - `extension.js` is the main entry point.
  - Additional scripts (e.g. `appChooser.js`, `appDialog.js`) provide subcomponents.
  - Styles go in `stylesheet.css`.
- To call backend commands, use the `_send()` helper which invokes `atv_control.py` via `Gio.Subprocess`. The returned JSON is parsed for success or error.
- UI changes require re-running `./install.sh` and restarting GNOME Shell to take effect.
- Logs from `log()` appear in `journalctl /usr/bin/gnome-shell -f | grep -i appletv`.
### GNOME Shell Extension UI Gotchas

- **Dialog population**: Avoid `await` in dialog layout. Async I/O creates unpredictable event-loop resumption points that cause CSS/Clutter layout timing races. Cache data before opening the dialog and populate synchronously. If you must use `await`, use `Clutter.FixedLayout` with manual tile positioning instead of flow layouts.
- App chooser grid uses `Clutter.FixedLayout` with manually positioned tiles in
  `extension/appChooser.js`; tiles are sized at (50, 50) in a 4-column grid and
  positioned at exact pixel coordinates to avoid the CSS/layout timing race. Long
  app names are wrapped to two lines before rendering.

### Installation & Deployment

- `install.sh` sets up a Python venv at `~/.config/appletv-remote/venv`, installs dependencies, and copies scripts and extension files.
- After editing any project file, re-run `./install.sh` before testing.
- On Wayland, restart the session to load new extension code; on X11 use Alt+F2 `r`.

### Debugging

- Backend issues can be reproduced by manually running `atv_control.py` from the venv as described in GEMINI.md.
- Pairing/credential problems require rerunning `atv_setup.py` and regenerating `devices.json`.
- Use GNOME Shell logs for frontend errors and subprocess stderr.

### Feature Development

1. Determine if functionality belongs in backend or frontend (or both).
2. Add or modify commands in Python and update JS UI to call them.
3. Update `install.sh` if new Python packages are needed.
4. Keep UI logic and styling consistent with GNOME Shell guidelines.
5. Mock backend responses when designing UI components early.

### Interaction with Copilot

- Provide clear, focused prompts referencing file names, functions, or UX requirements.
- When asking for code examples, specify whether the context is Python or GJS.
- For debugging, include relevant log excerpts or error messages.
- If unsure where a change belongs, Copilot should suggest architecture and appropriate file(s).

## Documentation Update Policy

Keep AI instruction files current after every significant change:

- **After completing a milestone or feature**: Update `CLAUDE.md`, `GEMINI.md`, and `.github/copilot-instructions.md` to reflect new architecture, key files, or workflows.
- **After fixing a bug**: Note any patterns or gotchas discovered.
- **After adding or removing files or directories**: Update the relevant sections in all three files.
- **After failing or passing tests, or identifying new constraints**: Record them so future sessions start with correct context.

## Notes

- Changes in development workspace must be installed via `install.sh` to reflect in the running extension.
- Keep backups of `~/.config/appletv-remote/devices.json` when testing pairing.
- `apps.json` stores favorites plus the last seen full app list; the icon fetcher prioritizes favorites then processes the rest alphabetically.
- Respect GNOME Shell formatting and use St widgets when implementing new UI elements.

---

These instructions are meant for GitHub Copilot (the assistant) to generate accurate, context-aware help for contributors working on this repository.