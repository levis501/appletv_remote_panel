Bug: user is not prompted to select a device after the initial scan of devices during installation.
Repro: fresh install of Apple TV Remote, run through installation process, observe that user is not prompted to select a device after the initial scan of devices.
Expected: user should be prompted to select a device after the initial scan of devices during installation.

Notes: Below is a transcript of the installation process, showing that after the initial scan of devices, the user is not prompted to select a device.


=== Installation complete ===

Would you like to configure devices now? [Y/n]: 

Scanning for available devices...
{"devices": [{"name": "AppleTV Office", "id": "9E:6F:F7:CE:B4:79", "address": "10.0.0.100", "model": "Apple TV 4"}, {"name": "AppleTV Solarium", "id": "8E:52:40:FD:2C:D0", "address": "10.0.0.155", "model": "Apple TV 4K (gen 3)"}]}


=== Apple TV Remote — Device Manager ===

Configured devices:
  (no devices configured)

Options:
  [a] Scan and add / re-pair devices
  [q] Quit / Done

Choice: a
Scanning network for Apple TVs (5 second timeout)...

Found 2 device(s):

  [1] AppleTV Solarium  (10.0.0.155)  [Apple TV 4K (gen 3)]
       id: 8E:52:40:FD:2C:D0
  [2] AppleTV Office  (10.0.0.100)  [Apple TV 4]
       id: 9E:6F:F7:CE:B4:79

Enter number to configure (or 'all', or blank to cancel): 
