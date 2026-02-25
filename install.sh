#!/usr/bin/env bash
# install.sh — Install the Apple TV Remote GNOME Shell extension
# Run from the project root: ./install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

EXTENSION_UUID="appletv-remote@local"
EXTENSION_SRC="${SCRIPT_DIR}/extension"
EXTENSION_DEST="${HOME}/.local/share/gnome-shell/extensions/${EXTENSION_UUID}"

HELPER_DIR="${HOME}/.config/appletv-remote"
PYTHON_VENV="${HELPER_DIR}/venv"
VENV_PYTHON="${PYTHON_VENV}/bin/python3"

echo "=== Apple TV Remote Panel — Installation ==="
echo ""

# ── 1. Check python3 ──────────────────────────────────────────────────────────
echo "[1/6] Checking Python..."

if ! command -v python3 &>/dev/null; then
    echo "ERROR: python3 not found. Please install Python 3.7+."
    exit 1
fi

PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "  Python ${PY_VER} found."

if ! python3 -c "import venv" &>/dev/null; then
    echo "ERROR: python3-venv not available."
    echo "       Install it with: sudo apt install python3-venv"
    exit 1
fi

# ── 2. Create config directory ────────────────────────────────────────────────
echo ""
echo "[2/6] Creating config directory..."
mkdir -p "${HELPER_DIR}"
mkdir -p "${HELPER_DIR}/icons"   # cache dir for downloaded app icons
echo "  ${HELPER_DIR}"

# ── 3. Python venv + pyatv ────────────────────────────────────────────────────
echo ""
echo "[3/6] Setting up Python virtual environment..."

if [ ! -d "${PYTHON_VENV}" ]; then
    python3 -m venv "${PYTHON_VENV}"
    echo "  Created venv at ${PYTHON_VENV}"
else
    echo "  Existing venv found."
fi

"${PYTHON_VENV}/bin/pip" install --quiet --upgrade pip
echo "  Installing pyatv (may take a moment)..."
"${PYTHON_VENV}/bin/pip" install --quiet pyatv
echo "  pyatv installed."
echo "  Installing duckduckgo-search and Pillow..."
"${PYTHON_VENV}/bin/pip" install --quiet duckduckgo-search Pillow
echo "  duckduckgo-search and Pillow installed."

# ── 4. Install Python helpers ─────────────────────────────────────────────────
echo ""
echo "[4/6] Installing helper scripts..."

# Copy scripts
cp "${SCRIPT_DIR}/atv_control.py"       "${HELPER_DIR}/atv_control.py"
cp "${SCRIPT_DIR}/atv_setup.py"         "${HELPER_DIR}/atv_setup.py"
cp "${SCRIPT_DIR}/atv_daemon.py"        "${HELPER_DIR}/atv_daemon.py"
cp "${SCRIPT_DIR}/atv_color_fetcher.py" "${HELPER_DIR}/atv_color_fetcher.py"

# Rewrite shebang to use the venv's Python so the script is self-contained
sed -i "1s|.*|#!${VENV_PYTHON}|" "${HELPER_DIR}/atv_control.py"
sed -i "1s|.*|#!${VENV_PYTHON}|" "${HELPER_DIR}/atv_setup.py"
sed -i "1s|.*|#!${VENV_PYTHON}|" "${HELPER_DIR}/atv_daemon.py"
sed -i "1s|.*|#!${VENV_PYTHON}|" "${HELPER_DIR}/atv_color_fetcher.py"
chmod +x "${HELPER_DIR}/atv_control.py"
chmod +x "${HELPER_DIR}/atv_setup.py"
chmod +x "${HELPER_DIR}/atv_daemon.py"
chmod +x "${HELPER_DIR}/atv_color_fetcher.py"

echo "  atv_control.py       → ${HELPER_DIR}/atv_control.py"
echo "  atv_setup.py         → ${HELPER_DIR}/atv_setup.py"
echo "  atv_daemon.py        → ${HELPER_DIR}/atv_daemon.py"
echo "  atv_color_fetcher.py → ${HELPER_DIR}/atv_color_fetcher.py"
echo "  Using Python:           ${VENV_PYTHON}"

# ── 5. Install GNOME extension ────────────────────────────────────────────────
echo ""
echo "[5/6] Installing GNOME Shell extension..."

mkdir -p "${EXTENSION_DEST}"
cp "${EXTENSION_SRC}/metadata.json"   "${EXTENSION_DEST}/metadata.json"
cp "${EXTENSION_SRC}/extension.js"    "${EXTENSION_DEST}/extension.js"
cp "${EXTENSION_SRC}/stylesheet.css"  "${EXTENSION_DEST}/stylesheet.css"
cp "${EXTENSION_SRC}/appDialog.js"    "${EXTENSION_DEST}/appDialog.js"
cp "${EXTENSION_SRC}/appChooser.js"   "${EXTENSION_DEST}/appChooser.js"
cp "${EXTENSION_SRC}/deviceDialog.js" "${EXTENSION_DEST}/deviceDialog.js"

if [ -f "${EXTENSION_SRC}/atv_remote.png" ]; then
    cp "${EXTENSION_SRC}/atv_remote.png" "${EXTENSION_DEST}/atv_remote.png"
fi

# Also copy the icons, if the directory exists
if [ -d "${EXTENSION_SRC}/icons" ]; then
    cp -r "${EXTENSION_SRC}/icons" "${EXTENSION_DEST}/"
fi

echo "  Installed to: ${EXTENSION_DEST}"

# ── 6. Enable extension ───────────────────────────────────────────────────────
echo ""
echo "[6/6] Enabling extension..."

if command -v gnome-extensions &>/dev/null; then
    if gnome-extensions enable "${EXTENSION_UUID}" 2>/dev/null; then
        echo "  Extension enabled."
    else
        echo "  Could not auto-enable (normal on Wayland — see next steps)."
    fi
else
    echo "  gnome-extensions not found — enable manually (see next steps)."
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "=== Installation complete ==="
echo ""

# ── Show known devices (quick, no network scan) ───────────────────────────────
if [ -f "${HELPER_DIR}/devices.json" ]; then
    "${VENV_PYTHON}" <<'PYEOF'
import json, os
p = os.path.expanduser("~/.config/appletv-remote/devices.json")
try:
    cfg = json.load(open(p))
    devices = cfg.get("devices", [])
    if devices:
        selected = cfg.get("selected")
        print("Known devices:")
        for d in devices:
            marker = "  <-- selected" if d.get("id") == selected else ""
            creds  = []
            if "credentials_mrp"       in d: creds.append("mrp")
            if "credentials_companion" in d: creds.append("companion")
            state  = ("[" + ", ".join(creds) + "]") if creds else "[not paired]"
            print(f"  - {d.get('name', '?'):20s}  {state}{marker}")
        print()
except Exception:
    pass
PYEOF
fi

# ── Optional: configure devices now ──────────────────────────────────────────
# Skip if devices are already configured; only prompt on a fresh install.
_has_devices=false
if [ -f "${HELPER_DIR}/devices.json" ]; then
    if "${VENV_PYTHON}" -c \
        "import json,sys; d=json.load(open('${HELPER_DIR}/devices.json')); sys.exit(0 if d.get('devices') else 1)" \
        2>/dev/null; then
        _has_devices=true
    fi
fi
if ! $_has_devices; then
    read -r -p "Would you like to configure devices now? [Y/n]: " _setup_answer || _setup_answer=""
    _setup_answer="${_setup_answer:-Y}"
    if [[ "${_setup_answer,,}" =~ ^(y|yes)$ ]]; then
        echo ""
        "${HELPER_DIR}/atv_setup.py" || true
        echo ""
    fi
fi

echo "Next steps:"
echo ""
echo "  1. To add or manage devices at any time:"
echo "     ${HELPER_DIR}/atv_setup.py"
echo ""
echo "  2. If the TV icon isn't visible in the top bar yet:"
echo "     X11:    press Alt+F2, type 'r', press Enter"
echo "     Wayland: log out and log back in"
echo ""
echo "  3. To manually enable the extension:"
echo "     gnome-extensions enable ${EXTENSION_UUID}"
echo "     or open the GNOME Extensions app."
echo ""
echo "  4. To debug, watch GNOME Shell logs:"
echo "     journalctl /usr/bin/gnome-shell -f | grep appletv"
