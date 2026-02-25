#!/usr/bin/env python3
"""
atv_setup.py — Apple TV device manager.

Run this interactively to add, remove, or re-pair Apple TVs on your network.
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


def print_device_list(cfg):
    devices = cfg.get("devices", [])
    if not devices:
        print("  (no devices configured)")
        return
    for i, d in enumerate(devices):
        marker = "  <-- selected" if d["id"] == cfg.get("selected") else ""
        has_mrp  = "mrp"         if "credentials_mrp"       in d else "NO MRP"
        has_comp = "+ companion"  if "credentials_companion" in d else ""
        print(f"  [{i}] {d['name']:20s}  [{has_mrp} {has_comp}]{marker}")


async def discover_devices():
    import pyatv
    from pyatv.const import OperatingSystem
    print("Scanning network for Apple TVs (5 second timeout)...")
    found = await pyatv.scan(asyncio.get_event_loop(), timeout=5)
    # Filter to only include Apple TVs (tvOS devices)
    return [
        a for a in found
        if a.device_info and a.device_info.operating_system == OperatingSystem.TvOS
    ]


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


async def cmd_add_devices(cfg):
    """Scan the network and add or re-pair chosen devices."""
    atvs = await discover_devices()

    if not atvs:
        print("\nNo Apple TVs found.")
        print("Make sure your Apple TVs are powered on and on the same network.")
        return

    configured_ids = {d["id"] for d in cfg.get("devices", [])}

    print(f"\nFound {len(atvs)} device(s):\n")
    for i, atv in enumerate(atvs):
        info    = atv.device_info
        model   = str(info.model_str) if info else "Unknown"
        already = "  [already configured]" if atv.identifier in configured_ids else ""
        print(f"  [{i}] {atv.name}  ({atv.address})  [{model}]{already}")
        print(f"       id: {atv.identifier}")

    print()
    selection = input("Enter number to configure (or 'all', or blank to cancel): ").strip().lower()

    if not selection:
        return

    if selection == "all":
        chosen = atvs
    else:
        try:
            chosen = [atvs[int(selection)]]
        except (ValueError, IndexError):
            print("Invalid selection.")
            return

    for atv_config in chosen:
        print(f"\n{'='*55}")
        print(f"  Configuring: {atv_config.name}")
        print(f"  ID:          {atv_config.identifier}")
        print("="*55)

        # Preserve any existing per-device config (e.g. volume settings)
        existing = next(
            (d for d in cfg["devices"] if d["id"] == atv_config.identifier), None
        )
        entry = {
            "name":    atv_config.name,
            "id":      atv_config.identifier,
            "address": str(atv_config.address),
        }
        if existing and "config" in existing:
            entry["config"] = existing["config"]

        # Step 1: MRP — required for all remote control and metadata
        print("\nStep 1/2: MRP pairing (required for remote control and metadata)")
        mrp_creds = await pair_protocol(atv_config, "mrp")
        if mrp_creds:
            entry["credentials_mrp"] = mrp_creds
        else:
            print("  WARNING: MRP pairing failed.")
            print("  All remote control commands and metadata polling require MRP.")
            print("  Possible causes:")
            print("    - Wrong PIN entered")
            print("    - Apple TV rejected the pairing request (try re-running setup)")
            print("    - The device may have timed out waiting for PIN entry")
            print("    - Very old tvOS versions may not support MRP")
            print("  This device will not function correctly without MRP credentials.")

        # Step 2: Companion — optional but recommended for tvOS 15+
        ans = input("\nStep 2/2: Pair Companion protocol? (recommended for tvOS 15+) [Y/n]: ")
        if ans.strip().lower() in ("y", "yes", ""):
            companion_creds = await pair_protocol(atv_config, "companion")
            if companion_creds:
                entry["credentials_companion"] = companion_creds

        # Update existing entry in-place or append
        if existing:
            idx = cfg["devices"].index(existing)
            cfg["devices"][idx] = entry
        else:
            cfg["devices"].append(entry)

        # Auto-select if nothing is selected yet
        if cfg.get("selected") is None:
            cfg["selected"] = entry["id"]

        print(f"\n  '{atv_config.name}' configured.")

    save_config(cfg)


def cmd_remove_device(cfg):
    """Remove a device from the config."""
    devices = cfg.get("devices", [])
    if not devices:
        print("  No devices to remove.")
        return

    print("\nConfigured devices:")
    print_device_list(cfg)
    print()

    raw = input("Enter number to remove (or blank to cancel): ").strip()
    if not raw:
        return

    try:
        idx = int(raw)
    except ValueError:
        print("Invalid selection.")
        return

    if idx < 0 or idx >= len(devices):
        print("Invalid selection.")
        return

    removed = devices.pop(idx)
    print(f"  Removed '{removed['name']}'.")

    # Update selected pointer if the removed device was selected
    if cfg.get("selected") == removed["id"]:
        cfg["selected"] = devices[0]["id"] if devices else None

    save_config(cfg)


async def setup():
    while True:
        cfg = load_config()
        devices = cfg.get("devices", [])

        print("\n=== Apple TV Remote — Device Manager ===\n")
        print("Configured devices:")
        print_device_list(cfg)

        print("\nOptions:")
        print("  [a] Scan and add / re-pair devices")
        if devices:
            print("  [r] Remove a device")
        print("  [q] Quit / Done")

        choice = input("\nChoice: ").strip().lower()

        if choice in ("q", ""):
            break
        elif choice == "a":
            await cmd_add_devices(cfg)
        elif choice == "r" and devices:
            cmd_remove_device(cfg)
        else:
            print("  Unknown option.")

    print("\nDone. Configured devices:")
    cfg = load_config()
    print_device_list(cfg)
    print()
    print("Next: enable the GNOME Shell extension, or reload it if already enabled.")
    print("      gnome-extensions enable appletv-remote@local")


if __name__ == "__main__":
    asyncio.run(setup())
