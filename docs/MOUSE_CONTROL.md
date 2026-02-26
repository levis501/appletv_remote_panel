Claude’s Plan
Plan: Apple TV Mouse Control Extension (appletv-mouse@local)
Context
The project has two panel indicators: the main remote (appletv-remote@local) and a play/pause button (appletv-playpause@local). This adds a third panel indicator that captures mouse input and translates it into Apple TV d-pad/select/volume commands. When activated, it creates a full-screen transparent overlay that intercepts all mouse events, and displays a floating info panel with a visual control map and sensitivity settings.

Architecture
Follows the exact same pattern as extension_playpause/:

Separate extension directory extension_mouse/
UUID: appletv-mouse@local
Inter-extension IPC via Extension.lookupByUUID('appletv-remote@local') → .getSelectedDevice() / .sendCommand()
No daemon changes needed
Input capture mechanism: A full-screen St.Widget with reactive: true is added to Main.uiGroup (above all UI including the panel). This is how GNOME Shell's own screenshot overlay and similar tools work. The cursor moves freely; our overlay intercepts all motion/click/scroll events. Returning Clutter.EVENT_STOP from every handler prevents events reaching the desktop or other apps.

New Files
extension_mouse/metadata.json

{
    "uuid": "appletv-mouse@local",
    "name": "Apple TV Mouse Control",
    "description": "Control Apple TV with mouse movements and clicks",
    "shell-version": ["45", "46"],
    "version": 1,
    "url": ""
}
extension_mouse/extension.js (~350 lines)
Constants:

DEFAULT_THRESHOLD = 30 — pixels of accumulated movement before firing a d-pad press
COOLDOWN_MS = 120 — minimum ms between d-pad fires (rate limiter)
SCROLL_COOLDOWN_MS = 300 — minimum ms between volume commands
FEEDBACK_MS = 200 — duration to highlight the active control in the info panel
Classes:

MouseInfoPanel (GObject.registerClass extends St.Widget)

Uses Clutter.FixedLayout, built synchronously in _init()
Fixed size: 240px × 320px
Positioned at top-right of primary monitor (30px from right edge, 48px from top)
Contains (all absolutely positioned):
Title row (y=0, h=28): "Mouse Control" with mouse icon label
Status row (y=28, h=22): "● Captured — right click to release"
Mouse button map (y=55, h=72): two side-by-side boxes for LEFT (Select) and RIGHT (Release), plus a SCROLL row (Volume ±)
Movement row (y=130, h=26): "Body Move → D-Pad"
D-pad visualizer (y=160, h=80): 5 cells in a + shape at absolute positions; each 26×26px
Sensitivity row (y=250, h=30): [−] label [value]px [+] buttons
Tips row (y=288, h=28): small label "Move=DPad Click=Select Right=Release"
Public methods:
getThreshold() → number
setActiveControl(name) — adds CSS .appletv-mouse-active to named element, clears after FEEDBACK_MS using GLib.timeout_add
MouseControlOverlay (GObject.registerClass extends St.Widget)

Full-screen, reactive: true, Clutter.FixedLayout
Sized to primary monitor in constructor (from Main.layoutManager.primaryMonitor)
Owns _infoPanel: MouseInfoPanel added as child
State: _lastX, _lastY, _accX, _accY, _lastFireTime, _lastScrollTime, _threshold
Event handlers: motion-event → _onMotion, button-press-event → _onButtonPress, scroll-event → _onScroll, key-press-event → _onKey
Calls grab_key_focus() after creation to receive Escape key
_onMotion: accumulate delta; when |accX| >= threshold || |accY| >= threshold and cooldown elapsed, pick dominant axis direction, call _sendCmd(dir), reset accumulators
_onButtonPress: button 1 → _sendCmd('select') + feedback; button 3 → call this._onExitRequested() callback
_onScroll: direction UP → _sendCmd('volume_up'), DOWN → _sendCmd('volume_down'), rate-limited by SCROLL_COOLDOWN_MS
_onKey: Escape → this._onExitRequested()
_sendCmd(cmd): calls mainExt.sendCommand(cmd, deviceId), catches/logs errors
MouseIndicator (GObject.registerClass extends PanelMenu.Button)

Created with dontCreateMenu: true (3rd arg to PanelMenu.Button)
Icon: input-mouse-symbolic (standard FreeDesktop icon available in GNOME 45/46)
_captured = false state; icon gets appletv-mouse-active CSS class when captured
connect('button-press-event') handler: if _captured → _exitCapture(); else → _enterCapture(); returns Clutter.EVENT_STOP
_enterCapture(): create MouseControlOverlay, add to Main.uiGroup, set _captured = true, update icon
_exitCapture(): _overlay?.destroy(), _overlay = null, set _captured = false, restore icon
MouseControlExtension (default export, extends Extension)

enable(): create MouseIndicator, add to panel with addToStatusArea(this.uuid, ...)
disable(): call _indicator._exitCapture() if captured, then _indicator.destroy()
extension_mouse/stylesheet.css (~80 lines)
Key classes:


.appletv-mouse-panel           { background: rgba(20,20,20,0.92); border: 1px solid #444; border-radius: 8px; padding: 8px; }
.appletv-mouse-title           { font-weight: bold; color: #eee; }
.appletv-mouse-status          { color: #aaa; font-size: 11px; }
.appletv-mouse-btn-left        { background: #2a2a2a; border: 1px solid #555; border-radius: 4px; color: #ccc; font-size: 11px; }
.appletv-mouse-btn-right       { background: #2a2a2a; border: 1px solid #555; border-radius: 4px; color: #ccc; font-size: 11px; }
.appletv-mouse-btn-scroll      { background: #2a2a2a; border: 1px solid #555; border-radius: 4px; color: #ccc; font-size: 11px; }
.appletv-mouse-btn-move        { background: #252525; border: 1px solid #444; border-radius: 4px; color: #aaa; font-size: 11px; }
.appletv-mouse-active          { background: #00aa44 !important; color: #fff !important; border-color: #00ff66 !important; }
.appletv-mouse-dpad-cell       { background: #2a2a2a; border: 1px solid #555; border-radius: 4px; color: #ccc; }
.appletv-mouse-dpad-center     { background: #333; border-radius: 4px; }
.appletv-mouse-threshold-btn   { background: #333; border: 1px solid #555; border-radius: 4px; color: #eee; width: 22px; height: 22px; }
.appletv-mouse-threshold-val   { color: #eee; min-width: 40px; }
.appletv-mouse-tips            { color: #666; font-size: 10px; }
/* Panel icon highlight when captured */
.appletv-mouse-indicator-active .system-status-icon { color: #00ff66; }
Files to Modify
install.sh
Add after the play/pause block (around line 124):


# ── 6b. Install mouse control extension ──────────────────────────────────────
echo ""
echo "[6b] Installing mouse control extension..."

MOUSE_UUID="appletv-mouse@local"
MOUSE_SRC="${SCRIPT_DIR}/extension_mouse"
MOUSE_DEST="${HOME}/.local/share/gnome-shell/extensions/${MOUSE_UUID}"

mkdir -p "${MOUSE_DEST}"
cp "${MOUSE_SRC}/metadata.json"  "${MOUSE_DEST}/metadata.json"
cp "${MOUSE_SRC}/extension.js"   "${MOUSE_DEST}/extension.js"
cp "${MOUSE_SRC}/stylesheet.css" "${MOUSE_DEST}/stylesheet.css"

echo "  Installed to: ${MOUSE_DEST}"
And in the enable block (step 7), add:


if gnome-extensions enable "${MOUSE_UUID}" 2>/dev/null; then
    echo "  ${MOUSE_UUID} enabled."
else
    echo "  Could not auto-enable ${MOUSE_UUID} (normal on Wayland — see next steps)."
fi
Motion → D-Pad Algorithm

On each motion-event:
  dx = x - lastX;  dy = y - lastY
  accX += dx;  accY += dy
  lastX = x;  lastY = y

  if (|accX| >= threshold || |accY| >= threshold) AND (now - lastFireTime >= COOLDOWN_MS):
    direction = |accX| >= |accY| ? (accX>0 ? 'right' : 'left') : (accY>0 ? 'down' : 'up')
    sendCommand(direction, deviceId)
    highlight dpad_{direction} in info panel for FEEDBACK_MS
    accX = accY = 0
    lastFireTime = now
  else if (|accX| > 3*threshold || |accY| > 3*threshold):
    // Burst prevention: discard excess if cooldown hasn't cleared
    accX = accY = 0
Critical Design Rules
FixedLayout everywhere — info panel uses Clutter.FixedLayout with manual set_position() for every child. No FlowLayout, no BoxLayout. (per CLAUDE.md & project convention)
No async UI construction — _buildUI() in MouseInfoPanel._init() is fully synchronous
Highlight timers — use GLib.timeout_add(GLib.PRIORITY_DEFAULT, FEEDBACK_MS, () => { clearHighlight(); return GLib.SOURCE_REMOVE; }) — never reuse/cancel unless the panel is destroyed first
Cleanup — track all timer IDs; remove in destroy() override using GLib.source_remove()
Overlay above panel — Main.uiGroup.add_child(overlay) places it above the panel itself (correct for capture mode)
Verification
./install.sh — should deploy 3 extensions + enable them
Restart GNOME Shell (X11: Alt+F2 → r)
gnome-extensions enable appletv-mouse@local if not auto-enabled
Three icons visible in panel (TV remote, play/pause, mouse)
Click mouse icon → info panel appears, cursor still moves freely
Move mouse slowly in one direction → d-pad commands fire (check: journalctl /usr/bin/gnome-shell -f | grep appletv)
Scroll up/down → volume changes on Apple TV
Left click → select action fires on Apple TV
Right click → overlay dismissed, panel icon returns to normal appearance
Click panel icon again → re-enters capture mode
Adjust sensitivity with +/− buttons → verify different movement thresholds
Press Escape during capture → exits capture mode
Visual feedback: each action briefly highlights the corresponding element in the info panel