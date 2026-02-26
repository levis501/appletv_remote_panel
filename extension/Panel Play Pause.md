Panel Play Pause


Plan: Apple TV Play/Pause Second Panel Indicator
Context
The user wants a minimal second GNOME panel item — just a play/pause button — that controls whichever Apple TV is currently active in the main extension. This avoids needing to open the full remote panel for a single common action.

The core question is IPC: how should the second panel item talk to the active device / daemon?

Approach Evaluation
Option A: Unix socket daemon (standalone shared service)
Refactor atv_daemon.py to listen on ~/.config/appletv-remote/daemon.sock and write a PID file. Both extensions independently try to connect; the first one to run spawns the daemon.

✅ Either extension works even if the other is disabled
✅ Architecturally clean long-term
❌ Major refactor of daemon + both extension connection layers
❌ Overkill for a single-button use case
Option B: Extension.lookupByUUID (in-process API) — RECOMMENDED
Both extensions run inside the same GNOME Shell process (same JS engine). Add a small public API to the main extension class; the second extension calls it directly.

✅ Standard GNOME Shell inter-extension pattern
✅ Minimal changes — no daemon refactor
✅ Shares the existing daemon connection and open pyatv connections
✅ No extra processes or sockets
⚠️ If main extension is disabled, second indicator gracefully no-ops
Chosen approach: Option B, with a note that Option A is the right evolution if the play/pause button needs to operate independently in the future.

Implementation Plan
1. Add public API to main extension (extension/extension.js)
Add two methods to AppleTVRemoteExtension (the default export class):


// Expose selected device ID (read from indicator)
getSelectedDevice() {
    return this._indicator?._selectedId ?? null;
}

// Proxy a daemon command through the existing connection
sendCommand(command, ...args) {
    return this._indicator?._send(command, ...args) ?? Promise.reject(new Error('Not ready'));
}
These are the only surface the second extension needs.

File: extension/extension.js

Locate the AppleTVRemoteExtension class (the export default class)
Add the two methods above inside the class body
2. Create second extension directory
New directory: extension_playpause/

Files to create:

extension_playpause/metadata.json


{
  "id": "appletv-playpause@local",
  "name": "Apple TV Play/Pause",
  "description": "Quick play/pause toggle for Apple TV",
  "shell-version": ["46", "47", "48"],
  "version": 1
}
extension_playpause/extension.js

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'
import { Button } from 'resource:///org/gnome/shell/ui/panelMenu.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import St from 'gi://St'
Create a PanelMenu.Button with a media-playback-start-symbolic icon
On click:
Look up main extension: Extension.lookupByUUID('appletv-remote@local')
If found: const deviceId = main.getSelectedDevice(); main.sendCommand('play_pause', deviceId)
If not found or deviceId is null: log a warning, no-op
Add indicator to Main.panel._rightBox (left of notification area, or wherever suits)
enable() creates and adds the indicator; disable() destroys it
No state, no polling, no file monitoring needed for v1.

3. Update install.sh
After the existing extension deploy block, add:


PLAYPAUSE_UUID="appletv-playpause@local"
PLAYPAUSE_DEST="${HOME}/.local/share/gnome-shell/extensions/${PLAYPAUSE_UUID}"
mkdir -p "${PLAYPAUSE_DEST}"
cp extension_playpause/extension.js "${PLAYPAUSE_DEST}/"
cp extension_playpause/metadata.json "${PLAYPAUSE_DEST}/"
echo "Deployed play/pause indicator to ${PLAYPAUSE_DEST}"
4. Enable the second extension
After install, the user must enable it:


gnome-extensions enable appletv-playpause@local
Or via GNOME Extensions app / Settings → Extensions.

Critical Files
File	Change
extension/extension.js	Add getSelectedDevice() and sendCommand() to the export class
extension_playpause/metadata.json	New — extension manifest
extension_playpause/extension.js	New — panel indicator implementation
install.sh	Add deploy block for second extension
Verification
Run ./install.sh
Restart GNOME Shell (X11: Alt+F2 → r; Wayland: log out/in)
Enable: gnome-extensions enable appletv-playpause@local
Both indicators appear in the panel
Click the play/pause button — Apple TV responds
Check for errors: journalctl /usr/bin/gnome-shell -f | grep -i appletv
Disable the main extension — play/pause button silently no-ops (no crash)
Re-enable main extension — play/pause button works again immediately
Future: Daemon socket approach
If the play/pause button needs to work even when the main extension is disabled (e.g., for a standalone widget or status indicator), the next step would be:

Add asyncio.start_unix_server() to atv_daemon.py alongside stdin
Write a PID lock file so only one daemon runs
Both extensions spawn-if-absent and connect to daemon.sock
Replace Gio.Subprocess stdin/stdout in both extensions with Gio.UnixConnection
This is a significant refactor (~3× the scope of the current plan) and should be done as a separate milestone.