ISSUES_006.md

1) Two more hitboxes have been for skip left and skip right, in Azure and Bone.  See HITBOX_COLORMAP.md for their colors and extension/atv_remote_hitboxes.png for their position.  Remove the double-click logic and 400ms single-click delay for d-pad left and right.

2) in the device dialog, when the user hits "select" on an entry, the dialog should close.

3) The device dialog's pin entry number font color is too light.  use black.

4) Don't mention the connection type (MRP or Companion) to the user, especially take care to remove it from the device dialog.


5) Use the ddgs python interface to get colors for the apps. First, do an image search for:

        +"app name" site:apps.apple.com

    and grab the very first image. Ignoring any background color outside the rounded-square icon in the second, sample the two popular colors in the icon and use the first for the background of the app button and the second for the app button's text.  Adjust the colors to have high contrast.  Run a daemon that searches for the icons one at a time, starting with the app favorites, then alphabetically through the rest.  Update the colors of the icons as they are retrieved.  Once an icon colors are stored for an app, do not retrieve colors for that app again.

    