#!/usr/bin/env python3
"""
ftv_daemon.py — Persistent Fruit TV control daemon.

Started once by the GNOME Shell extension; keeps pyatv connections alive so
button presses don't pay a per-command scan + connect cost.

Protocol (stdin → stdout, newline-delimited JSON):
  Request:  {"id": "1", "cmd": "play_pause", "args": ["<device_id>"]}
  Response: {"id": "1", "result": {}}
         or {"id": "1", "error": "message"}

The daemon exits when stdin is closed (EOF).
"""

import asyncio
import json
import os
import sys

CONFIG_PATH = os.path.expanduser("~/.config/appletv-remote/devices.json")


# ── Config helpers ─────────────────────────────────────────────────────────────

def load_config():
    if not os.path.exists(CONFIG_PATH):
        return {"devices": [], "selected": None}
    try:
        with open(CONFIG_PATH) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {"devices": [], "selected": None}


def save_config(cfg):
    with open(CONFIG_PATH + ".tmp", "w") as f:
        json.dump(cfg, f, indent=2)
    os.rename(CONFIG_PATH + ".tmp", CONFIG_PATH)


def find_device(cfg, device_id):
    for dev in cfg.get("devices", []):
        if dev["id"] == device_id:
            return dev
    return None


# ── Daemon ────────────────────────────────────────────────────────────────────

class FTVDaemon:
    def __init__(self):
        self._connections = {}   # device_id -> atv object
        self._conn_locks = {}    # device_id -> asyncio.Lock (serialises reconnects)

    # ── I/O helpers ───────────────────────────────────────────────────────────

    def _respond(self, id_, *, result=None, error=None):
        if error is not None:
            msg = {"id": id_, "error": str(error)}
        else:
            msg = {"id": id_, "result": result if result is not None else {}}
        print(json.dumps(msg), flush=True)

    def _conn_lock(self, device_id):
        if device_id not in self._conn_locks:
            self._conn_locks[device_id] = asyncio.Lock()
        return self._conn_locks[device_id]

    # ── Connection management ──────────────────────────────────────────────────

    async def _build_config(self, entry):
        """Resolve device address/services and apply stored credentials."""
        import pyatv
        from pyatv.const import Protocol

        loop = asyncio.get_running_loop()
        atvs = []
        # Unicast to the stored address first — much faster than mDNS broadcast
        if entry.get("address"):
            atvs = await pyatv.scan(loop, hosts=[entry["address"]], timeout=5)
        if not atvs:
            atvs = await pyatv.scan(loop, identifier=entry["id"], timeout=5)
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

    async def _connect(self, device_id):
        """Open a fresh connection; store it in self._connections."""
        import pyatv

        cfg = load_config()
        entry = find_device(cfg, device_id)
        if entry is None:
            raise ValueError(f"Device '{device_id}' not found in config")

        config = await self._build_config(entry)
        if config is None:
            raise ConnectionError(f"Device '{device_id}' not found on network")

        atv = await pyatv.connect(config, asyncio.get_running_loop())
        self._connections[device_id] = atv
        return atv

    async def _get_connection(self, device_id, reconnect=False):
        """Return a cached or newly created connection; serialised per device."""
        async with self._conn_lock(device_id):
            if not reconnect and device_id in self._connections:
                return self._connections[device_id]
            await self._close_connection(device_id)
            return await self._connect(device_id)

    async def _close_connection(self, device_id):
        atv = self._connections.pop(device_id, None)
        if atv:
            try:
                atv.close()
            except Exception:
                pass

    async def _with_retry(self, device_id, fn):
        """Run fn(atv); on any exception reconnect once and retry."""
        try:
            atv = await self._get_connection(device_id)
            return await fn(atv)
        except Exception:
            atv = await self._get_connection(device_id, reconnect=True)
            return await fn(atv)

    # ── Command dispatch ───────────────────────────────────────────────────────

    async def _dispatch(self, cmd, args):
        from pyatv.const import PowerState

        # ── Commands that don't need a live device connection ─────────────────

        if cmd == "list_devices":
            cfg = load_config()
            return {
                "devices": [
                    {"name": d["name"], "id": d["id"], "address": d.get("address", "")}
                    for d in cfg.get("devices", [])
                ],
                "selected": cfg.get("selected"),
            }

        if cmd == "get_config_value":
            if len(args) < 2:
                raise ValueError("get_config_value requires device_id and key")
            cfg = load_config()
            entry = find_device(cfg, args[0])
            if entry is None:
                raise ValueError(f"Device '{args[0]}' not found")
            return {"value": entry.get("config", {}).get(args[1])}

        if cmd == "set_config_value":
            if len(args) < 3:
                raise ValueError("set_config_value requires device_id, key, value_json")
            cfg = load_config()
            entry = find_device(cfg, args[0])
            if entry is None:
                raise ValueError(f"Device '{args[0]}' not found")
            if "config" not in entry:
                entry["config"] = {}
            entry["config"][args[1]] = json.loads(args[2])
            save_config(cfg)
            return {"result": "ok"}

        if cmd == "select_device":
            if not args:
                raise ValueError("select_device requires device_id")
            cfg = load_config()
            cfg["selected"] = args[0]
            save_config(cfg)
            return {"selected": args[0]}

        if cmd == "remove_device":
            if not args:
                raise ValueError("remove_device requires device_id")
            device_id = args[0]
            cfg = load_config()
            cfg["devices"] = [d for d in cfg.get("devices", []) if d["id"] != device_id]
            if cfg.get("selected") == device_id:
                remaining = cfg.get("devices", [])
                cfg["selected"] = remaining[0]["id"] if remaining else None
            save_config(cfg)
            await self._close_connection(device_id)
            return {"removed": device_id}

        if cmd == "scan_devices":
            import pyatv as _pyatv
            from pyatv.const import OperatingSystem
            loop = asyncio.get_running_loop()
            found = await _pyatv.scan(loop, timeout=5)
            cfg = load_config()
            known_ids = {d["id"] for d in cfg.get("devices", [])}
            # Filter to only include Apple TVs (tvOS devices)
            apple_tvs = [
                a for a in found
                if a.device_info and a.device_info.operating_system == OperatingSystem.TvOS
            ]
            return {
                "devices": [
                    {
                        "name":    str(a.name),
                        "id":      a.identifier,
                        "address": str(a.address),
                        "known":   a.identifier in known_ids,
                    }
                    for a in apple_tvs
                ]
            }

        if cmd == "pair_begin":
            if len(args) < 3:
                raise ValueError("pair_begin requires device_id, address, protocol")
            import pyatv
            from pyatv.const import Protocol
            loop = asyncio.get_running_loop()
            device_id, address, proto_name = args[0], args[1], args[2]
            
            atvs = await pyatv.scan(loop, hosts=[address], timeout=5)
            if not atvs:
                atvs = await pyatv.scan(loop, identifier=device_id, timeout=5)
            if not atvs:
                raise ValueError("Device not found")
                
            config = atvs[0]
            proto_map = {
                "mrp": Protocol.MRP,
                "companion": Protocol.Companion,
                "airplay": Protocol.AirPlay,
            }
            if proto_name not in proto_map:
                raise ValueError("Unknown protocol")
                
            pairing = await pyatv.pair(config, proto_map[proto_name], loop)
            await pairing.begin()
            
            if not hasattr(self, "_active_pairings"):
                self._active_pairings = {}
            self._active_pairings[device_id] = (pairing, config)
            
            return {"status": "waiting_for_pin"}

        if cmd == "pair_pin":
            if len(args) < 2:
                raise ValueError("pair_pin requires device_id and pin")
            device_id, pin_str = args[0], args[1]
            
            if not hasattr(self, "_active_pairings") or device_id not in self._active_pairings:
                raise ValueError("No active pairing session for device")
                
            pairing, config = self._active_pairings[device_id]
            if not str(pin_str).isdigit():
                await pairing.close()
                del self._active_pairings[device_id]
                raise ValueError("Invalid PIN")
                
            pairing.pin(int(pin_str))
            await pairing.finish()
            
            if pairing.has_paired:
                cred = str(pairing.service.credentials)
                await pairing.close()
                del self._active_pairings[device_id]
                return {"credentials": cred, "name": config.name}
            else:
                await pairing.close()
                del self._active_pairings[device_id]
                raise ValueError("Pairing failed (wrong PIN?)")

        if cmd == "pair_save":
            if len(args) < 4:
                raise ValueError("pair_save requires device_id, address, name, credentials_dict")
            device_id, address, name, creds_dict = args[0], args[1], args[2], args[3]
            
            cfg = load_config()
            existing = next((d for d in cfg.get("devices", []) if d["id"] == device_id), None)
            
            entry = {
                "name": name,
                "id": device_id,
                "address": address,
            }
            if existing and "config" in existing:
                entry["config"] = existing["config"]
                
            if "mrp" in creds_dict:
                entry["credentials_mrp"] = creds_dict["mrp"]
            if "companion" in creds_dict:
                entry["credentials_companion"] = creds_dict["companion"]
                
            if existing:
                idx = cfg["devices"].index(existing)
                cfg["devices"][idx] = entry
            else:
                if "devices" not in cfg:
                    cfg["devices"] = []
                cfg["devices"].append(entry)
                
            if cfg.get("selected") is None:
                cfg["selected"] = device_id
                
            save_config(cfg)
            return {"status": "saved"}

        # ── Commands that require a live connection ────────────────────────────

        if not args:
            raise ValueError(f"Command '{cmd}' requires a device_id argument")
        device_id = args[0]

        if cmd == "power_state":
            async def _fn(atv):
                return {"on": atv.power.power_state == PowerState.On}
            return await self._with_retry(device_id, _fn)

        if cmd == "get_volume":
            async def _fn(atv):
                return {"volume": atv.audio.volume}
            return await self._with_retry(device_id, _fn)

        if cmd == "set_volume":
            if len(args) < 2:
                raise ValueError("set_volume requires level")
            level = float(args[1])
            if level < 0:
                level = 0.0
            if level > 100:
                level = 100.0
            async def _fn(atv, _level=level):
                await atv.audio.set_volume(_level)
                return {"volume": _level}
            return await self._with_retry(device_id, _fn)

        if cmd == "volume_mute":
            async def _fn(atv):
                try:
                    await atv.audio.set_volume(0.0)
                    return {"volume": 0}
                except Exception:
                    # Fallback: step volume down several times.
                    for _ in range(10):
                        await atv.audio.volume_down()
                    return {"volume": None}
            return await self._with_retry(device_id, _fn)

        if cmd == "get_metadata":
            async def _fn(atv):
                p = await atv.metadata.playing()
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
                duration = getattr(p, "total_time", None) or getattr(p, "duration", None)
                app = getattr(p, "app", None)
                app_id = app.identifier if (app and hasattr(app, "identifier")) else None
                return {
                    "device_state": str(p.device_state),
                    "title":    p.title  or "",
                    "artist":   p.artist or "",
                    "album":    p.album  or "",
                    "series":   series,
                    "position": p.position,
                    "duration": duration,
                    "app_id":   app_id,
                }
            return await self._with_retry(device_id, _fn)

        if cmd == "get_artwork":
            async def _fn(atv):
                artwork = await atv.metadata.artwork(width=160, height=160)
                if artwork is None or not artwork.bytes:
                    return {"artwork_path": None}
                path = "/tmp/appletv-remote-artwork"
                with open(path, "wb") as f:
                    f.write(bytes(artwork.bytes))
                return {"artwork_path": path, "mimetype": artwork.mimetype or "image/jpeg"}
            return await self._with_retry(device_id, _fn)

        if cmd == "list_apps":
            async def _fn(atv):
                apps = await atv.apps.app_list()
                return {"apps": [
                    {"name": a.name, "id": a.identifier}
                    for a in sorted(apps, key=lambda x: x.name.lower())
                ]}
            return await self._with_retry(device_id, _fn)

        if cmd == "launch_app":
            if len(args) < 2:
                raise ValueError("launch_app requires bundle_id")
            async def _fn(atv, _bundle=args[1]):
                await atv.apps.launch_app(_bundle)
                return {}
            return await self._with_retry(device_id, _fn)

        if cmd == "keyboard_set":
            if len(args) < 2:
                raise ValueError("keyboard_set requires text")
            async def _fn(atv, _text=args[1]):
                await atv.keyboard.text_set(_text)
                return {}
            return await self._with_retry(device_id, _fn)

        # ── Remote-control and power commands ─────────────────────────────────

        REMOTE_COMMANDS = {
            "play_pause", "stop", "volume_up", "volume_down",
            "skip_next", "skip_prev", "next_track", "prev_track",
            "select", "select_hold", "up", "down", "left", "right",
            "menu", "home", "top_menu",
            "power_on", "power_off",
        }
        if cmd in REMOTE_COMMANDS:
            async def _fn(atv, _cmd=cmd):
                import pyatv.const
                rc = atv.remote_control
                pw = atv.power
                command_map = {
                    "play_pause":  rc.play_pause,
                    "stop":        rc.stop,
                    "volume_up":   rc.volume_up,
                    "volume_down": rc.volume_down,
                    "skip_next":   rc.skip_forward,
                    "skip_prev":   rc.skip_backward,
                    "next_track":  rc.next,
                    "prev_track":  rc.previous,
                    "select":      rc.select,
                    "select_hold": lambda: rc.select(pyatv.const.InputAction.Hold),
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
                await command_map[_cmd]()
                return {}
            return await self._with_retry(device_id, _fn)

        raise ValueError(f"Unknown command: '{cmd}'")

    # ── Per-message executor ───────────────────────────────────────────────────

    async def _execute(self, msg):
        id_ = msg.get("id", "?")
        cmd  = msg.get("cmd", "")
        args = msg.get("args", [])
        try:
            result = await self._dispatch(cmd, args)
            self._respond(id_, result=result)
        except Exception as e:
            self._respond(id_, error=e)

    # ── Main read loop ─────────────────────────────────────────────────────────

    async def run(self):
        loop = asyncio.get_running_loop()
        reader = asyncio.StreamReader()
        protocol = asyncio.StreamReaderProtocol(reader)
        await loop.connect_read_pipe(lambda: protocol, sys.stdin)

        async for raw in reader:
            line = raw.decode().strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError as e:
                self._respond("?", error=f"Invalid JSON: {e}")
                continue
            # Fire-and-forget so multiple commands can be in-flight concurrently
            asyncio.create_task(self._execute(msg))

        # stdin closed — shut down open connections cleanly
        for device_id in list(self._connections):
            await self._close_connection(device_id)


if __name__ == "__main__":
    asyncio.run(FTVDaemon().run())
