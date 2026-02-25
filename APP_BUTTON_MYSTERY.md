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
