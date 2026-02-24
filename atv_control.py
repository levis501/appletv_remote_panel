#!/usr/bin/env python3
"""
atv_control.py — Apple TV control helper for the GNOME Shell extension.

Usage:
    atv_control.py scan
    atv_control.py status <device_id>
    atv_control.py power_state <device_id>
    atv_control.py get_volume <device_id>
    atv_control.py set_volume <device_id> <level_0_to_100>
    atv_control.py list_apps <device_id>
    atv_control.py launch_app <device_id> <bundle_id>
    atv_control.py <remote_command> <device_id>
      remote commands: play_pause stop volume_up volume_down
                       skip_next skip_prev next_track prev_track
                       select up down left right menu home top_menu
                       power_on power_off

All stdout is JSON. Errors print {"error":"..."} to stdout+stderr and exit 1.
"""

import asyncio
import json
import os
import sys

CONFIG_PATH = os.path.expanduser("~/.config/appletv-remote/devices.json")


def save_config(cfg):
    """Atomically write the config file."""
    with open(CONFIG_PATH + ".tmp", "w") as f:
        json.dump(cfg, f, indent=2)
    os.rename(CONFIG_PATH + ".tmp", CONFIG_PATH)


def find_device(cfg, device_id):
    for dev in cfg.get("devices", []):
        if dev["id"] == device_id:
            return dev
    return None


def cmd_get_config_value(entry, key):
    """Get a config value for a device."""
    config_node = entry.get("config", {})
    out({"value": config_node.get(key)})


def cmd_set_config_value(cfg, device_id, key, value_str):
    """Set a config value for a device."""
    entry = find_device(cfg, device_id)
    if entry is None:
        die(f"Could not find device {device_id} to set config")

    if "config" not in entry:
        entry["config"] = {}

    try:
        entry["config"][key] = json.loads(value_str)
        save_config(cfg)
        out({"result": "ok"})
    except json.JSONDecodeError:
        die(f"Invalid JSON for config value: {value_str}")


def out(obj):
    print(json.dumps(obj))
    sys.stdout.flush()



def die(msg):
    payload = json.dumps({"error": msg})
    print(payload)
    print(payload, file=sys.stderr)
    sys.stdout.flush()
    sys.exit(1)


async def build_config(entry):
    """Scan for device and apply stored credentials."""
    import pyatv
    from pyatv.const import Protocol

    loop = asyncio.get_running_loop()
    atvs = await pyatv.scan(loop, identifier=entry["id"], timeout=5)
    if not atvs and entry.get("address"):
        atvs = await pyatv.scan(loop, hosts=[entry["address"]], timeout=5)
    if not atvs:
        return None

    config = atvs[0]
    if "credentials_mrp" in entry:
        config.set_credentials(Protocol.MRP, entry["credentials_mrp"])
    if "credentials_companion" in entry:
        config.set_credentials(Protocol.Companion, entry["credentials_companion"])
    if "credentials_airplay" in entry:
        config.set_credentials(Protocol.AirPlay, entry["credentials_airplay"])
    return config


# ── Commands ──────────────────────────────────────────────────────────────────

async def cmd_scan():
    import pyatv
    found = await pyatv.scan(asyncio.get_running_loop(), timeout=5)
    out({"devices": [
        {
            "name":    a.name,
            "id":      a.identifier,
            "address": str(a.address),
            "model":   str(a.device_info.model_str) if a.device_info else "Unknown",
        }
        for a in found
    ]})


async def cmd_status(entry):
    import pyatv
    from pyatv.const import DeviceState

    config = await build_config(entry)
    if config is None:
        die(f"Device not found: {entry['id']}")

    atv = await pyatv.connect(config, asyncio.get_running_loop())
    try:
        p = await atv.metadata.playing()
        out({
            "playing":      p.device_state in (DeviceState.Playing, DeviceState.Loading),
            "title":        p.title or "",
            "artist":       p.artist or "",
            "album":        p.album or "",
            "app":          p.app or "",
            "device_state": str(p.device_state),
        })
    finally:
        atv.close()


async def cmd_power_state(entry):
    import pyatv
    from pyatv.const import PowerState

    config = await build_config(entry)
    if config is None:
        die(f"Device not found: {entry['id']}")

    atv = await pyatv.connect(config, asyncio.get_running_loop())
    try:
        out({"on": atv.power.power_state == PowerState.On})
    finally:
        atv.close()


async def cmd_get_metadata(entry):
    """Fast metadata poll: title, artist, album, series, position, duration."""
    import pyatv
    from pyatv.const import DeviceState

    config = await build_config(entry)
    if config is None:
        die(f"Device not found: {entry['id']}")

    atv = await pyatv.connect(config, asyncio.get_running_loop())
    try:
        p = await atv.metadata.playing()

        # Build a combined series string: "Breaking Bad S3E7"
        series = ""
        sn = getattr(p, "series_name", None)
        if sn:
            series = sn
            season  = getattr(p, "season_number",  None)
            episode = getattr(p, "episode_number", None)
            if season is not None and episode is not None:
                series += f" S{season}E{episode}"
            elif episode is not None:
                series += f" E{episode}"

        # Duration attribute name varies between pyatv versions
        duration = getattr(p, "total_time", None) or getattr(p, "duration", None)

        out({
            "device_state": str(p.device_state),
            "title":    p.title  or "",
            "artist":   p.artist or "",
            "album":    p.album  or "",
            "series":   series,
            "position": p.position,  # int seconds or None
            "duration": duration,    # int seconds or None
        })
    finally:
        atv.close()


async def cmd_get_artwork(entry):
    """Fetch album/cover art, write to temp file, return path."""
    import pyatv

    config = await build_config(entry)
    if config is None:
        die(f"Device not found: {entry['id']}")

    atv = await pyatv.connect(config, asyncio.get_running_loop())
    try:
        artwork = await atv.metadata.artwork(width=160, height=160)
        if artwork is None or not artwork.bytes:
            out({"artwork_path": None})
            return

        path = "/tmp/appletv-remote-artwork"
        with open(path, "wb") as f:
            f.write(bytes(artwork.bytes))
        out({"artwork_path": path, "mimetype": artwork.mimetype or "image/jpeg"})
    finally:
        atv.close()


async def cmd_keyboard_set(entry, text):
    """Send text to the Apple TV's current text field."""
    import pyatv

    config = await build_config(entry)
    if config is None:
        die(f"Device not found: {entry['id']}")

    atv = await pyatv.connect(config, asyncio.get_running_loop())
    try:
        await atv.keyboard.text_set(text)
    finally:
        atv.close()


async def cmd_list_apps(entry):
    import pyatv

    config = await build_config(entry)
    if config is None:
        die(f"Device not found: {entry['id']}")

    atv = await pyatv.connect(config, asyncio.get_running_loop())
    try:
        apps = await atv.apps.app_list()
        out({"apps": [
            {"name": a.name, "id": a.identifier}
            for a in sorted(apps, key=lambda x: x.name.lower())
        ]})
    finally:
        atv.close()


async def cmd_launch_app(entry, bundle_id):
    import pyatv

    config = await build_config(entry)
    if config is None:
        die(f"Device not found: {entry['id']}")

    atv = await pyatv.connect(config, asyncio.get_running_loop())
    try:
        await atv.apps.launch_app(bundle_id)
    finally:
        atv.close()


async def cmd_remote(entry, command):
    """Send a RemoteControl or Power command."""
    import pyatv

    config = await build_config(entry)
    if config is None:
        die(f"Device not found: {entry['id']}")

    atv = await pyatv.connect(config, asyncio.get_running_loop())
    try:
        rc = atv.remote_control
        pw = atv.power
        command_map = {
            "play_pause":  rc.play_pause,
            "stop":        rc.stop,
            "volume_up":   rc.volume_up,
            "volume_down": rc.volume_down,
            "skip_next":   rc.skip_forward,   # 10-second skip forward
            "skip_prev":   rc.skip_backward,  # 10-second skip backward
            "next_track":  rc.next,           # next track / chapter
            "prev_track":  rc.previous,       # previous track / chapter
            "select":      rc.select,
            "up":          rc.up,
            "down":        rc.down,
            "left":        rc.left,
            "right":       rc.right,
            "menu":        rc.menu,
            "home":        rc.home,
            "top_menu":    rc.top_menu,
            "power_on":    pw.turn_on,
            "power_off":   pw.turn_off,
        }
        if command not in command_map:
            die(f"Unknown command: {command}")
        await command_map[command]()
        # Empty stdout = success
    finally:
        atv.close()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    args = sys.argv[1:]
    if not args:
        die("No command given")

    command = args[0]

    if command == "scan":
        asyncio.run(cmd_scan())
        return

    if len(args) < 2:
        die(f"Command '{command}' requires a device_id argument")

    device_id = args[1]
    cfg = load_config()
    entry = find_device(cfg, device_id)
    if entry is None:
        die(f"Device '{device_id}' not found in {CONFIG_PATH}")

    if command == "status":
        asyncio.run(cmd_status(entry))
    elif command == "get_metadata":
        asyncio.run(cmd_get_metadata(entry))
    elif command == "get_artwork":
        asyncio.run(cmd_get_artwork(entry))
    elif command == "keyboard_set":
        if len(args) < 3:
            die("keyboard_set requires a text argument")
        asyncio.run(cmd_keyboard_set(entry, args[2]))
    elif command == "power_state":
        asyncio.run(cmd_power_state(entry))
    elif command == "get_config_value":
        if len(args) < 3:
            die("get_config_value requires a key argument")
        cmd_get_config_value(entry, args[2])
    elif command == "set_config_value":
        if len(args) < 4:
            die("set_config_value requires key and value_json arguments")
        cmd_set_config_value(cfg, device_id, args[2], args[3])
    elif command == "list_apps":
        asyncio.run(cmd_list_apps(entry))
    elif command == "launch_app":
        if len(args) < 3:
            die("launch_app requires a bundle_id argument")
        asyncio.run(cmd_launch_app(entry, args[2]))
    else:
        asyncio.run(cmd_remote(entry, command))


if __name__ == "__main__":
    main()
