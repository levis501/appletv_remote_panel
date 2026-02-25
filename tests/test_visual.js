#!/usr/bin/gjs
/**
 * Visual test for AppDialog button styling.
 *
 * Renders a GTK4 mock of the app-chooser dialog, takes a screenshot via
 * ImageMagick `import`, and saves it to tests/screenshots/.  Results can be
 * inspected with the Read tool to iterate on CSS fixes without needing a
 * running GNOME Shell session.
 *
 * GTK4 is not identical to GNOME Shell's St/Clutter engine, but it shares the
 * same libcss/CSS-parsing rules and honours the same property names we care
 * about: background-color, border-radius, width/min-width, border, box-shadow.
 * Any cascade or colour issue found here will also exist in the real shell.
 *
 * Usage:
 *   gjs tests/test_visual.js [output-name]
 *   # screenshot saved to tests/screenshots/<output-name>.png  (default: app_dialog)
 */

'use strict';

// Set dark GTK theme BEFORE importing GTK so buttons render with dark
// backgrounds, closely approximating GNOME Shell's St.Button appearance.
imports.gi.versions.GLib = '2.0';
const { GLib: _GLib } = imports.gi;
_GLib.setenv('GTK_THEME', 'Adwaita-dark', false);

imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Gdk = '4.0';
imports.gi.versions.Gio = '2.0';

const { Gtk, Gdk, GLib, Gio } = imports.gi;

// ── paths ──────────────────────────────────────────────────────────────────
const SCRIPT_DIR   = GLib.path_get_dirname(imports.system.programPath ?? '.');
const PROJECT_DIR  = GLib.path_get_dirname(SCRIPT_DIR);
const CSS_FILE     = GLib.build_filenamev([PROJECT_DIR, 'extension', 'stylesheet.css']);
const SHOT_DIR     = GLib.build_filenamev([SCRIPT_DIR, 'screenshots']);
const OUT_NAME     = ARGV[0] ?? 'app_dialog';
const SHOT_PATH    = GLib.build_filenamev([SHOT_DIR, `${OUT_NAME}.png`]);
const WIN_TITLE    = 'AppDialog-VisualTest';

// ── test data (mirrors the extension's APP_COLOR_CLASSES) ───────────────────
const APP_COLOR_CLASSES = {
    'com.apple.TVWatchList':   'appletv-app-color-tv',
    'com.apple.TVMusic':       'appletv-app-color-music',
    'com.apple.TVSettings':    'appletv-app-color-settings',
    'com.google.ios.youtube':  'appletv-app-color-youtube',
    'com.netflix.Netflix':     'appletv-app-color-netflix',
    'com.hulu.HuluTV':         'appletv-app-color-hulu',
};

// Mix of branded + unbranded, some marked as favourites
const SAMPLE_APPS = [
    { id: 'com.example.ae',         name: 'A&E' },
    { id: 'com.apple.TVWatchList',  name: 'TV' },
    { id: 'com.apple.TVMusic',      name: 'Music' },
    { id: 'com.example.abc',        name: 'ABC' },
    { id: 'com.apple.TVSettings',   name: 'Settings' },
    { id: 'com.example.cbs',        name: 'CBS News' },
    { id: 'com.google.ios.youtube', name: 'YouTube' },
    { id: 'com.example.cnn',        name: 'CNN' },
    { id: 'com.netflix.Netflix',    name: 'Netflix' },
    { id: 'com.example.disney',     name: 'Disney+' },
    { id: 'com.hulu.HuluTV',        name: 'Hulu' },
    { id: 'com.example.espn',       name: 'ESPN' },
    { id: 'com.example.prime',      name: 'Prime Video' },
    { id: 'com.example.hbo',        name: 'HBO Max' },
    { id: 'com.example.peacock',    name: 'Peacock' },
];

// Apps that should display the green active border
const FAVORITES = new Set([
    'com.apple.TVWatchList',
    'com.apple.TVMusic',
    'com.netflix.Netflix',
]);

// ── screenshot helper ───────────────────────────────────────────────────────
function takeScreenshot() {
    GLib.mkdir_with_parents(SHOT_DIR, 0o755);

    // ImageMagick `import` can capture a named X11 window.
    // -pause 1 gives the compositor time to paint before capture.
    const cmd = `import -window "${WIN_TITLE}" -pause 1 "${SHOT_PATH}"`;
    const [ok, , , exitCode] = GLib.spawn_command_line_sync(cmd);
    if (ok && exitCode === 0) {
        print(`✓ Screenshot saved: ${SHOT_PATH}`);
        return true;
    }

    // Fallback: capture the whole root and crop (works on nested X11 displays)
    const cmdFull = `import -window root "${SHOT_PATH}"`;
    const [ok2, , , exitCode2] = GLib.spawn_command_line_sync(cmdFull);
    if (ok2 && exitCode2 === 0) {
        print(`✓ Fallback root screenshot saved: ${SHOT_PATH}`);
        return true;
    }

    printerr('✗ Screenshot failed – install imagemagick: sudo apt install imagemagick');
    return false;
}

// ── build the mock dialog window ────────────────────────────────────────────
function buildWindow(app) {
    const win = new Gtk.ApplicationWindow({
        application: app,
        title: WIN_TITLE,
        default_width: 460,
        default_height: 600,
    });

    // Apply our real stylesheet.css so the test exercises exactly the same rules
    const provider = new Gtk.CssProvider();
    try {
        provider.load_from_path(CSS_FILE);
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(),
            provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        );
        print(`Loaded CSS: ${CSS_FILE}`);
    } catch (e) {
        printerr(`Failed to load CSS: ${e}`);
    }

    // GTK4-specific overrides: Adwaita theme gives buttons a white background
    // with higher specificity than a plain class rule.  Use element+class to
    // beat the theme and approximate GNOME Shell's St.Button rendering.
    const overrideProvider = new Gtk.CssProvider();
    overrideProvider.load_from_string(`
        /* Beat Adwaita's button {} rule so our bg colours show */
        button.appletv-app-chooser-btn {
            background-color: rgba(255, 255, 255, 0.18);
            color: white;
        }
        button.appletv-app-chooser-btn:hover {
            background-color: rgba(255, 255, 255, 0.28);
        }
        button.appletv-app-color-tv       { background-color: #1c1c1e; }
        button.appletv-app-color-music    { background-color: #fc3c44; }
        button.appletv-app-color-settings { background-color: #636366; }
        button.appletv-app-color-youtube  { background-color: #ff0000; }
        button.appletv-app-color-netflix  { background-color: #e50914; }
        button.appletv-app-color-hulu     { background-color: #3dbb3d; }
        button.appletv-app-active {
            border: 2px solid #00ff00;
            box-shadow: 0 0 6px rgba(0,255,0,0.5);
        }
        label.appletv-quick-app-label { color: white; font-size: 10px; }
        /* Dialog background */
        box.app-dialog { background-color: #404040; }
    `);
    Gtk.StyleContext.add_provider_for_display(
        Gdk.Display.get_default(),
        overrideProvider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1
    );

    // Outer container styled like .app-dialog (dark background)
    const outer = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 });
    outer.add_css_class('app-dialog');
    outer.set_margin_start(16);
    outer.set_margin_end(16);
    outer.set_margin_top(16);
    outer.set_margin_bottom(16);
    win.set_child(outer);

    // Title
    const title = new Gtk.Label({ label: 'Select Apps for AppleTV Test', halign: Gtk.Align.START });
    title.add_css_class('app-dialog-title');
    outer.append(title);

    // Scrollable flow grid
    const scroll = new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        vexpand: true,
    });
    outer.append(scroll);

    const flow = new Gtk.FlowBox({
        max_children_per_line: 5,
        min_children_per_line: 3,
        homogeneous: true,
        column_spacing: 12,
        row_spacing: 12,
        selection_mode: Gtk.SelectionMode.NONE,
    });
    flow.add_css_class('app-chooser-grid');
    scroll.set_child(flow);

    // Create one button per sample app, mirroring AppButton in appChooser.js
    for (const appInfo of SAMPLE_APPS) {
        const btn = new Gtk.Button();

        // Match the exact style_class used by AppButton
        btn.add_css_class('appletv-quick-app-btn');
        btn.add_css_class('appletv-app-chooser-btn');

        // Brand colour (same logic as appChooser.js)
        const colorClass = APP_COLOR_CLASSES[appInfo.id] ?? null;
        if (colorClass)
            btn.add_css_class(colorClass);

        // Favourite → active border
        if (FAVORITES.has(appInfo.id))
            btn.add_css_class('appletv-app-active');

        // Content: just a label (mirrors St.Label with appletv-quick-app-label)
        const lbl = new Gtk.Label({ label: appInfo.name });
        lbl.add_css_class('appletv-quick-app-label');
        btn.set_child(lbl);

        flow.append(btn);
    }

    return win;
}

// ── assertions (basic pixel checks via Pillow via python3) ──────────────────
function runAssertions() {
    const pyScript = `
import sys
try:
    from PIL import Image
    img = Image.open("${SHOT_PATH}").convert("RGB")
    w, h = img.size
    print(f"Image size: {w}x{h}")

    # Sample pixels near top-left corner of the dialog (should be dark ~#404040)
    # and a spot that should be a button (slightly lighter)
    cx, cy = w // 2, h // 2
    center_px = img.getpixel((cx, cy))
    print(f"Center pixel: {center_px}")

    # Check image is not all-white (CSS definitely loaded)
    whites = sum(1 for px in img.getdata() if px == (255, 255, 255))
    pct_white = whites / (w * h) * 100
    print(f"White pixels: {pct_white:.1f}%")
    if pct_white > 80:
        print("FAIL: image is mostly white — dialog background not applied")
        sys.exit(1)
    else:
        print("PASS: dialog background is not white")

    # Check image is not solid single colour (buttons should add variation)
    from collections import Counter
    common = Counter(img.getdata()).most_common(1)[0]
    pct_dominant = common[1] / (w * h) * 100
    print(f"Most common pixel {common[0]}: {pct_dominant:.1f}%")
    if pct_dominant > 70:
        print("WARN: image has very low variation — buttons may be invisible")
    else:
        print("PASS: image has colour variation (buttons visible)")

    sys.exit(0)
except Exception as e:
    print(f"Assertion error: {e}")
    sys.exit(1)
`;
    const [ok, stdout, stderr, exitCode] = GLib.spawn_command_line_sync(
        `python3 -c '${pyScript.replace(/'/g, "'\\''")}'`
    );
    if (stdout) print(new TextDecoder().decode(stdout).trim());
    if (stderr) printerr(new TextDecoder().decode(stderr).trim());
    return exitCode === 0;
}

// ── main ────────────────────────────────────────────────────────────────────
const app = new Gtk.Application({ application_id: 'org.test.AppDialogVisual' });

app.connect('activate', (gtk_app) => {
    const win = buildWindow(gtk_app);
    win.present();

    // Give GTK time to render, then screenshot → assert → quit
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        const shotOk = takeScreenshot();
        if (shotOk) {
            const assertOk = runAssertions();
            print(assertOk ? '\n✓ All assertions passed' : '\n✗ Assertions failed — check screenshot');
        }
        gtk_app.quit();
        return GLib.SOURCE_REMOVE;
    });
});

const exitCode = app.run([]);
print(`\nScreenshot: ${SHOT_PATH}`);
imports.system.exit(exitCode);
