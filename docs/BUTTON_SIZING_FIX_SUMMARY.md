# App Chooser Button Sizing: Problem & Solution

## The Problem

The app chooser dialog buttons exhibited a non-deterministic rendering bug: on some opens, buttons rendered at their correct size (89 × 50 px), but on other opens they collapsed to the width of their text labels. This was a true race condition between `Clutter.FlowLayout` (which measures children via `get_preferred_width/height()` callbacks) and GNOME Shell's embedded CSS engine (which resolves styles lazily relative to the Clutter frame cycle). When `FlowLayout` queried button preferred sizes before CSS had flushed the `width`/`min-width` properties, the layout manager read the button's raw content size instead of the CSS-declared size—and that undersized allocation became permanent.

## What Made This Problem Unique To Our Application

Most developers never encounter this issue because it requires a specific confluence of design choices found in GNOME Shell extensions:

1. **Async population in Clutter context**: We use `await this._extension.getApps()` inside `_loadApps()`. This async/await creates a continuation that resumes at an unpredictable point in the GLib event loop, and that resumption point determines when CSS resolution happens relative to layout measurement.

2. **GNOME Shell's non-standard CSS engine**: Unlike web browsers or GTK's CSS engine, GNOME Shell's CSS processor is a partial implementation with its own lazy resolution schedule tied to the Clutter scene graph's frame cycle. The exact frame in which computed styles are flushed is non-deterministic and depends on event loop contention at the moment the async continuation fires.

3. **FlowLayout preferred-size measurement**: Most UI frameworks (web, GTK) use document reflow or constraint-based layout. Clutter's `FlowLayout` is a discrete layout manager that queries preferred sizes once per layout pass. There's no automatic re-measurement if styles change mid-measurement, creating an irreversible allocation if CSS hasn't resolved yet.

The combination of **async loading + lazy CSS resolution + discrete preferred-size measurement** is uncommon outside GNOME Shell extension development. Most web and desktop frameworks either handle CSS synchronously or re-measure automatically, hiding this race condition. Our application exposed it because we were building dynamic UI in Clutter—a scene graph designed for animation, not document layout—within a GNOME Shell context where CSS resolution is deliberately lazy for performance reasons.

## The Solution

Rather than try to synchronize CSS with layout (which the race condition made impossible), we bypassed the race entirely by replacing `Clutter.FlowLayout` with `Clutter.FixedLayout` and manually positioning tiles at exact pixel coordinates. Since `FixedLayout` never invokes `get_preferred_width/height()`, the CSS timing race is eliminated. Tiles are positioned imperatively at fixed (x, y) coordinates in a 3-column grid, guaranteeing deterministic sizing and layout across all opens.

