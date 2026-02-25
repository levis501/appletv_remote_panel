#!/usr/bin/env python3
"""atv_color_fetcher.py — Fetch dominant colours from app icons via the iTunes API.

For each favourite app in ~/.config/appletv-remote/apps.json, and then all other
apps listed there (in alphabetical order), this script:
  1. Looks up the app icon URL from the iTunes Search API using the bundle ID.
  2. Falls back to an iTunes name search for third-party apps not found by ID.
  3. Downloads the icon image.
  4. Extracts the dominant vibrant colour (hue-bucket weighted average).
  5. Picks white or black text for WCAG contrast.
  6. Writes results atomically to ~/.config/appletv-remote/app_colors.json.

Already-processed apps (including failed ones stored as null) are skipped on
subsequent runs, so the script is safe to re-run whenever new favourites are added.
"""

import io
import json
import os
import sys
import time
import colorsys
import urllib.request
import urllib.parse
from pathlib import Path
from collections import defaultdict

CONFIG_DIR    = Path.home() / '.config' / 'appletv-remote'
APPS_CONFIG   = CONFIG_DIR / 'apps.json'
COLORS_CONFIG = CONFIG_DIR / 'app_colors.json'
ICONS_DIR     = CONFIG_DIR / 'icons'
REQUEST_DELAY = 1.5   # seconds between iTunes API calls


def _log(msg):
    print(f'[atv_color_fetcher] {msg}', file=sys.stderr, flush=True)


# ── Config I/O ────────────────────────────────────────────────────────────────

def load_apps_config():
    try:
        with open(APPS_CONFIG) as f:
            data = json.load(f)
        favorites = data.get('favorites', [])
        apps = data.get('apps', [])
        if not isinstance(favorites, list):
            favorites = []
        if not isinstance(apps, list):
            apps = []
        return favorites, apps
    except Exception as e:
        _log(f'Could not read apps config: {e}')
        return [], []


def load_colors():
    try:
        with open(COLORS_CONFIG) as f:
            return json.load(f)
    except Exception:
        return {}


def save_colors(colors):
    """Write colors atomically via a temp file so readers never see a partial write."""
    tmp = str(COLORS_CONFIG) + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(colors, f, indent=2)
    os.replace(tmp, str(COLORS_CONFIG))


# ── Colour math ───────────────────────────────────────────────────────────────

def rgb_to_hex(r, g, b):
    return f'#{int(r):02x}{int(g):02x}{int(b):02x}'


def relative_luminance(r, g, b):
    def ch(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast_ratio(c1, c2):
    l1 = relative_luminance(*c1)
    l2 = relative_luminance(*c2)
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def best_text_color(bg_rgb):
    """Return white or black, whichever gives higher WCAG contrast against bg_rgb."""
    white, black = (255, 255, 255), (0, 0, 0)
    return white if contrast_ratio(bg_rgb, white) >= contrast_ratio(bg_rgb, black) else black


# ── Image processing ──────────────────────────────────────────────────────────

def extract_dominant_color(image_data):
    """Extract the dominant vibrant colour from raw icon image bytes.

    Strategy:
      1. Convert to RGBA, scale to ≤100 px for speed.
      2. Discard transparent (alpha < 128) and near-white pixels
         (these are typically the rounded-rect icon background on apple.com).
      3. Bucket remaining pixels into 12 hue sectors.
      4. The sector with the highest cumulative saturation×value wins.
      5. Take a weighted-average colour within that sector.
      6. Choose white or black text for best WCAG contrast.

    Returns {'bg': '#rrggbb', 'text': '#rrggbb'} or None on failure.
    """
    try:
        from PIL import Image
    except ImportError:
        _log('Pillow not installed — cannot extract colours')
        return None

    try:
        img = Image.open(io.BytesIO(image_data)).convert('RGBA')
        img.thumbnail((100, 100), Image.LANCZOS)
        w, h = img.size

        pixels = []
        for y in range(h):
            for x in range(w):
                r, g, b, a = img.getpixel((x, y))
                if a < 128:
                    continue      # transparent
                if r > 220 and g > 220 and b > 220:
                    continue      # near-white background
                pixels.append((r, g, b))

        if not pixels:
            _log('  No usable pixels (all transparent or white)')
            return None

        # Bucket by hue sector, weighted by saturation × value (prefers vivid colours)
        buckets = defaultdict(list)
        for r, g, b in pixels:
            h_val, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            sector = int(h_val * 12) % 12
            weight = s * v
            buckets[sector].append((r, g, b, weight))

        best = max(buckets.values(), key=lambda items: sum(w for *_, w in items))

        total_w = sum(w for *_, w in best) or 1
        br  = sum(r * w for r, _g, _b, w in best) / total_w
        bg_ = sum(g * w for _r, g, _b, w in best) / total_w
        bb  = sum(b * w for _r, _g, b, w in best) / total_w
        bg_rgb = (int(br), int(bg_), int(bb))

        text_rgb = best_text_color(bg_rgb)
        return {
            'bg':   rgb_to_hex(*bg_rgb),
            'text': rgb_to_hex(*text_rgb),
        }

    except Exception as e:
        _log(f'  Colour extraction error: {e}')
        return None


# ── iTunes API ────────────────────────────────────────────────────────────────

def _itunes_get(url):
    """Fetch a JSON response from the iTunes API."""
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def _icon_from_itunes_result(result):
    return result.get('artworkUrl512') or result.get('artworkUrl100')


def search_icon_url(app_name, app_id):
    """Find the app icon URL via the iTunes Search API.

    Strategy:
      1. Lookup by bundle ID (exact match) — works for most third-party apps.
      2. If not found and the app is not a com.apple.* system app, fall back to
         a name search and accept the first result whose bundle ID shares the
         same company prefix as app_id (e.g. com.netflix.*).
    """
    # 1. Exact lookup by bundle ID
    try:
        url = f'https://itunes.apple.com/lookup?bundleId={urllib.parse.quote(app_id)}&entity=software'
        data = _itunes_get(url)
        results = data.get('results', [])
        if results:
            icon = _icon_from_itunes_result(results[0])
            if icon:
                _log(f'  iTunes lookup by bundle ID succeeded')
                return icon
    except Exception as e:
        _log(f'  iTunes lookup failed: {e}')

    # 2. Apple system apps (com.apple.TV*) won't be in the public store
    if app_id.startswith('com.apple.'):
        _log(f'  Apple system app — skipping name search')
        return None

    # 3. Name search fallback: require bundle ID company prefix to match
    time.sleep(REQUEST_DELAY)
    try:
        company_prefix = '.'.join(app_id.split('.')[:2])   # e.g. "com.netflix"
        q = urllib.parse.quote(app_name)
        url = f'https://itunes.apple.com/search?term={q}&entity=software&limit=5'
        data = _itunes_get(url)
        results = data.get('results', [])
        for r in results:
            if r.get('bundleId', '').startswith(company_prefix):
                icon = _icon_from_itunes_result(r)
                if icon:
                    _log(f'  iTunes name search matched bundleId={r["bundleId"]}')
                    return icon
        # Last resort: take any first result if name search returned something
        if results:
            icon = _icon_from_itunes_result(results[0])
            if icon:
                _log(f'  iTunes name search: using first result (bundleId={results[0].get("bundleId")})')
                return icon
    except Exception as e:
        _log(f'  iTunes name search failed: {e}')

    return None


def download_image(url):
    """Download bytes from url; return None on failure."""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.read()
    except Exception as e:
        _log(f'  Download failed: {e}')
    return None


def save_icon(app_id, data):
    """Save raw icon bytes to the icons cache directory as {app_id}.png."""
    try:
        ICONS_DIR.mkdir(parents=True, exist_ok=True)
        icon_path = ICONS_DIR / f'{app_id}.png'
        icon_path.write_bytes(data)
        _log(f'  Saved icon → {icon_path}')
    except Exception as e:
        _log(f'  Failed to save icon: {e}')


# ── Per-app pipeline ──────────────────────────────────────────────────────────

def fetch_colors_for_app(app):
    """Run the full lookup → download → extract pipeline for one app.
    Returns a colour dict on success, None on any failure.
    """
    name   = app.get('name', '')
    app_id = app.get('id', '')
    _log(f'Processing: {name!r} ({app_id})')

    url = search_icon_url(name, app_id)
    if not url:
        _log('  No icon URL found')
        return None

    data = download_image(url)
    if not data:
        return None

    save_icon(app_id, data)

    colors = extract_dominant_color(data)
    if colors:
        _log(f'  bg={colors["bg"]}  text={colors["text"]}')
    else:
        _log('  Could not extract colours')
    return colors


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    _log('starting')
    favorites, apps = load_apps_config()
    colors = load_colors()

    if not favorites and not apps:
        _log('No apps found in config — nothing to do')
        return

    fav_ids = {a.get('id') for a in favorites if isinstance(a, dict) and a.get('id')}
    non_favorites = [
        a for a in apps
        if isinstance(a, dict) and a.get('id') and a.get('id') not in fav_ids
    ]
    non_favorites.sort(key=lambda a: (a.get('name', '').lower(), a.get('id', '')))
    ordered_apps = favorites + non_favorites

    # Fetch an app if:
    #   - it has no colour entry yet (None or missing), OR
    #   - it has colours but is missing its icon file (e.g. fetcher ran before icon-saving was added)
    # Apple system apps (com.apple.*) never have Store icons, so skip icon check for them.
    def needs_fetch(app):
        entry = colors.get(app['id'])
        if not isinstance(entry, dict):
            return True   # no colours yet — always try
        if app['id'].startswith('com.apple.'):
            return False  # system app: colours done, no icon expected
        return not (ICONS_DIR / f"{app['id']}.png").exists()

    to_fetch = [a for a in ordered_apps if needs_fetch(a)]

    if not to_fetch:
        _log('All apps already processed — nothing to do')
        return

    _log(f'{len(to_fetch)} app(s) to process')

    for app in to_fetch:
        result = fetch_colors_for_app(app)
        # Store result; None marks a failed attempt so we don't retry each run
        colors[app['id']] = result
        try:
            save_colors(colors)
        except Exception as e:
            _log(f'  Failed to save colors: {e}')
        time.sleep(REQUEST_DELAY)

    _log('done')


if __name__ == '__main__':
    main()
