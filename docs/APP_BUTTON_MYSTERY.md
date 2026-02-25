# App Button Dialog — Rendering Mystery

## The Tech Stack

The app-chooser dialog sits at the intersection of two distinct systems that were never
designed to work together. The visible buttons are `St.Button` widgets — part of **St
(Shell Toolkit)**, GNOME Shell's own widget library built on top of **Clutter**, a scene
graph originally designed for animated media players. Clutter is not a document renderer;
it has no reflow engine. Layout is handled by discrete **layout managers**
(`Clutter.FlowLayout` in this case), which measure children by calling
`get_preferred_width/height()` on each actor at a specific moment in the frame pipeline.
Styling is applied by **GNOME Shell's embedded CSS engine** — a partial, non-standards
implementation that supports a subset of CSS properties and has its own rules about when
computed styles are resolved relative to the layout pass. This CSS engine is entirely
separate from the WebKit/Blink/Gecko engines web developers are used to; it does not
guarantee that a style is applied before or after a widget is allocated.

## The Disconnect

The inconsistency (some buttons sized correctly, some collapsing to bare text width,
varying between opens of the same dialog) is a **race condition between CSS resolution and
layout allocation**. When `_loadApps()` resumes after its `await`, it adds all `AppButton`
widgets to the `FlowLayout` grid in a tight synchronous `for` loop. Clutter queues a layout
pass, but GNOME Shell's CSS engine resolves computed styles lazily — the exact frame in
which styles are flushed depends on the state of the main GLib event loop at the moment the
async continuation runs. If the layout pass fires before CSS is resolved, `FlowLayout` reads
each child's preferred size as its raw content size (the width of the text label), and those
children are allocated at the wrong size permanently. If CSS resolves first, `FlowLayout`
reads the correct `width`/`min-width` values and allocates them at 59 × 50 px. Because the
outcome depends on event-loop timing rather than code ordering, it is non-deterministic: the
same build can render correctly or incorrectly on successive opens of the dialog. This is why
every pure-CSS approach — cascade ordering, compound selectors, `!important`, `min-width` —
has produced intermittent results. The fix must be **imperative**: size must be set on each
actor *after* it is staged and CSS has been resolved, not declared in a stylesheet that may
or may not be flushed before the layout manager measures the children.

## Fix Applied

1. Add each `AppButton` to the grid and then schedule a `GLib.idle_add` callback to apply
	`set_size(59, 50)` on the next main-loop tick. This forces a stable allocation after the
	actor is staged and CSS has had a chance to resolve.
2. Keep the CSS size rules as a fallback, but do not rely on them for layout correctness.
3. If the issue resurfaces, wrap each button in a fixed-size `St.Bin` and size the bin
	instead, or replace `St.Button` with a plain `St.Widget` with `reactive: true`.

## Other fix ideas

1. Force style resolve before layout: Call btn.ensure_style() (or this._grid.ensure_style()) and then queue_relayout() after all buttons are added. It can still be flaky, but in practice it often stabilizes.
2. Wrap in a fixed-size bin: Create a St.Bin with a fixed size (set set_size) and put the St.Button inside; the FlowLayout measures the bin, not the button, so it gets a stable rect.
3. Drop St.Button for the grid: Use a St.Widget with reactive: true and handle press events directly. The “button theme” is the thing most likely to add hidden padding and variability.
4. Image-backed rectangles: If you want to go the image route, use a fixed-size St.Widget with background-image (or a Clutter.Image) so layout is driven by the actor size, not CSS.

## Fix Attempt 2 (Bin Wrapper)

The idle-time `set_size` is still racing on some opens (see AppDialogBug6a.png), so the
next attempt is to wrap each `AppButton` in a fixed-size `St.Bin` and add the bin to the
`FlowLayout`. The grid then measures the bin (stable 59 x 50), while the button fills the
bin via `x_align/y_align: FILL` and `x_expand/y_expand: true`.

Expected result: the layout manager never queries the button's preferred size, so CSS
timing cannot collapse the button width. If this still fails, the next step is to replace
`St.Button` with a plain `St.Widget` and handle press events directly.

## Result (Attempt 2)

The fixed-size `St.Bin` wrapper did not resolve the race; some opens still collapse the
buttons to text width (see AppDialogBug6a.png).

## Fix Attempt 3 (Plain Widget Button)

Replace `St.Button` with a plain `St.Widget` (reactive, focusable) and handle
`button-press-event`/`button-release-event` directly. The button theme layer is removed, so
preferred-size calculations should no longer fluctuate. The widget keeps the same style
classes so the existing CSS still applies, and a fixed-size wrapper remains as a belt-and-
suspenders measure.

## Result (Attempt 3)

Attempt 3 failed immediately: `St.Widget` does not implement `set_child()`, so the dialog
throws `this.set_child is not a function` before any layout test can occur.

## Fix Attempt 3a (Plain Bin Tile)

Switch the base class to `St.Bin` instead of `St.Widget`. `St.Bin` is still a lightweight
container (no button theme), but it provides `set_child()` and keeps the reactive event
handling. This preserves the intent of Attempt 3 while avoiding the API mismatch.

## Fix Attempt 4 (Force Style Resolve + Relayout)

Explicitly force style resolution and a relayout after all app tiles are added. The idea is
to make sure CSS is flushed before `Clutter.FlowLayout` measures preferred sizes. After the
add loop, call `this._grid.ensure_style()` and then `this._grid.queue_relayout()`.

## Fix Attempt 5 (Image-Backed Rectangles)

Use a `Clutter.Canvas` as the tile's content to provide a fixed, image-backed preferred size
(59 x 50). The canvas draws a fully transparent rectangle, so the existing CSS background
colors still show through, but layout is now driven by the image size rather than CSS. The
tile is a plain `St.Widget` with a `Clutter.BinLayout`, and it adds the label/icon box as a
child via `add_child()` instead of `set_child()`.

## Result (Attempt 5)

Image-backed rectangles failed with `Canvas is not a constructor`. `Clutter.Canvas` is not
available or not a constructor in this GNOME Shell context.

## Fix Attempt 6 (Fixed Layout with Manual Positioning)

Replace `Clutter.FlowLayout` with `Clutter.FixedLayout` and manually position tiles at exact
pixel coordinates (no preferred-size measurement at all). Tiles use `St.Button` again with
fixed size set imperatively at `btn.set_size()` and `btn.set_position()`. This eliminates the
race entirely since `FixedLayout` never invokes `get_preferred_width/height()` — it only
allocates at the actor's set size and position.