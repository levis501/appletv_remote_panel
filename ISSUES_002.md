ISSUES_002.md

1) Add a section to CLAUDE.md, GEMINI.md and copilot-instructions.md that these files should be updated after milestones.  Also consider updating them after fixing bugs, failed tests, adding or removing files or directories.


2) A new hitbox was added in dark green, HITBOX_COLORMAP.md has the exact color rgb for the hitbox in atv_remote_hitboxes.png.  The user tapping on this hitbox should open a window where the user can manage known devices.  From this window, the user should be able to scan for more devices, select the current device, or remove devices.

3) Remove the device selector at the top of the main window

4) Wait the 400ms after the user taps on left/right dpad before sending any signal.  Only fire left or right if the user does not tap again within that window.

5) move the apps buttons higher up in the main window, to just 12 pixels below the lowest hitbox.  make them a narrower so that three buttons across with will 12px margins on the left and right of the set, and 12px spacing between each button.

6) if we know what the current active app is, and we have a button for it, place a bright green border around that button while the app is active.
