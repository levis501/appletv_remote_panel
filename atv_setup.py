#!/usr/bin/env python3
"""
atv_setup.py — One-time Apple TV pairing and setup wizard.

Run this interactively to discover and pair Apple TVs on your network.
Credentials are saved to ~/.config/appletv-remote/devices.json.

Usage:
    python3 atv_setup.py
"""

import asyncio
import json
import os
import sys

CONFIG_DIR  = os.path.expanduser("~/.config/appletv-remote")
CONFIG_PATH = os.path.join(CONFIG_DIR, "devices.json")


def load_config():
    if not os.path.exists(CONFIG_PATH):
        return {"devices": [], "selected": None}
    try:
        with open(CONFIG_PATH) as f:
            return json.load(f)
    except json.JSONDecodeError:
        print(f"Warning: could not parse {CONFIG_PATH} — starting fresh.")
        return {"devices": [], "selected": None}


def save_config(cfg):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)
    print(f"\nConfig saved to {CONFIG_PATH}")


async def discover_devices():
    import pyatv
    print("Scanning network for Apple TVs (5 second timeout)...")
    return await pyatv.scan(asyncio.get_event_loop(), timeout=5)


async def pair_protocol(atv_config, protocol_name):
    """Pair one protocol. Returns credential string or None on failure."""
    import pyatv
    from pyatv.const import Protocol

    proto_map = {
        "mrp":       Protocol.MRP,
        "companion": Protocol.Companion,
        "airplay":   Protocol.AirPlay,
    }
    protocol = proto_map[protocol_name]

    print(f"\n  Starting {protocol_name.upper()} pairing with '{atv_config.name}'...")
    print("  A PIN should appear on your Apple TV screen.")

    try:
        pairing = await pyatv.pair(atv_config, protocol, asyncio.get_event_loop())
        await pairing.begin()

        pin_str = input("  Enter the PIN shown on your Apple TV: ").strip()
        if not pin_str.isdigit():
            print("  Invalid PIN — must be digits only. Skipping.")
            await pairing.close()
            return None

        pairing.pin(int(pin_str))
        await pairing.finish()

        if pairing.has_paired:
            cred = str(pairing.service.credentials)
            print(f"  Pairing successful!")
            await pairing.close()
            return cred
        else:
            print("  Pairing failed — wrong PIN?")
            await pairing.close()
            return None

    except Exception as e:
        print(f"  Pairing error: {e}")
        return None


async def setup():
    atvs = await discover_devices()

    if not atvs:
        print("\nNo Apple TVs found.")
        print("Make sure your Apple TVs are powered on and on the same network.")
        sys.exit(1)

    print(f"\nFound {len(atvs)} device(s):\n")
    for i, atv in enumerate(atvs):
        info = atv.device_info
        model = str(info.model_str) if info else "Unknown"
        print(f"  [{i}] {atv.name}  ({atv.address})  [{model}]")
        print(f"       id: {atv.identifier}")

    print()
    selection = input("Enter number to configure (or 'all'): ").strip().lower()

    if selection == "all":
        chosen = atvs
    else:
        try:
            chosen = [atvs[int(selection)]]
        except (ValueError, IndexError):
            print("Invalid selection.")
            sys.exit(1)

    cfg = load_config()

    for atv_config in chosen:
        print(f"\n{'='*55}")
        print(f"  Configuring: {atv_config.name}")
        print(f"  ID:          {atv_config.identifier}")
        print("="*55)

        # Find existing entry or create new one
        existing = next(
            (d for d in cfg["devices"] if d["id"] == atv_config.identifier), None
        )
        entry = existing or {
            "name":    atv_config.name,
            "id":      atv_config.identifier,
            "address": str(atv_config.address),
        }

        # Companion is optional but recommended for tvOS 15+
        # try pairing it first, since most of our devices are on tvOS 15+
        ans = input("\nStep 1/2: Pair Companion protocol? (recommended for tvOS 15+) [Y/n]: ")
        if ans.strip().lower() in ("y", "yes", ""):
            companion_creds = await pair_protocol(atv_config, "companion")
            if companion_creds:
                entry["credentials_companion"] = companion_creds

        # Always pair MRP — required for remote control and metadata
        print("\nStep 2/2: MRP pairing (required for all remote control)")
        mrp_creds = await pair_protocol(atv_config, "mrp")
        if mrp_creds:
            entry["credentials_mrp"] = mrp_creds
        else:
            print("  WARNING: MRP pairing failed. Remote control will not work.")

        # Update or append
        if existing:
            idx = cfg["devices"].index(existing)
            cfg["devices"][idx] = entry
        else:
            cfg["devices"].append(entry)

        # Auto-select first device or if only one device
        if cfg["selected"] is None or len(cfg["devices"]) == 1:
            cfg["selected"] = entry["id"]

        print(f"\n  '{atv_config.name}' configured.")

    save_config(cfg)

    print("\nSetup complete! Configured devices:")
    for dev in cfg["devices"]:
        marker = "  <-- selected" if dev["id"] == cfg["selected"] else ""
        has_mrp = "mrp" if "credentials_mrp" in dev else "NO MRP"
        has_comp = "+ companion" if "credentials_companion" in dev else ""
        print(f"  - {dev['name']:20s}  [{has_mrp} {has_comp}]{marker}")

    print()
    print("Next: enable the GNOME Shell extension, or reload it if already enabled.")
    print("      gnome-extensions enable appletv-remote@local")


if __name__ == "__main__":
    asyncio.run(setup())
