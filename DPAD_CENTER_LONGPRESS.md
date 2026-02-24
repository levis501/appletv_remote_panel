# D-Pad Center Long Press

A long-press on the D-Pad center (Select button) can be transmitted to the Apple TV using the `pyatv` library.

The `pyatv.interface.RemoteControl` interface provides a `select()` method which takes an optional `action` parameter of type `pyatv.const.InputAction`. By passing `InputAction.Hold` (which equals `2`), `pyatv` sends a long press event for the select button.

```python
import pyatv
from pyatv.const import InputAction

# ... inside an established connection ...
await atv.remote_control.select(InputAction.Hold)
```

## Sensing a Long Press in the GNOME Extension

In GJS / GNOME Shell extensions using `St.Button`, we can sense a long press by utilizing `Clutter.ClickAction` which provides a `long-press` signal, or by managing our own timeout between `button-press-event` and `button-release-event`. 

Since `St.Button` consumes the standard `button-press-event` for clicks, replacing `button-press-event` with a custom timer requires intercepting the event, starting a GLib timeout, and canceling it on release. If the timer fires before the release, we send a `'select_hold'` command to the daemon. If the release happens before the timer, we cancel the timer and send a normal `'select'` command.

The Python backend (`atv_daemon.py` and `atv_control.py`) needs to be updated to recognize a new `'select_hold'` command and translate that into `await atv.remote_control.select(InputAction.Hold)`.
