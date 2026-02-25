# System App Icons

Create 512x512 icons for the system apps as detailed below:

## Original Icons
- **TV**: the apple icon from the extension and the letters lowercase "tv". Black background, white letters. Large letters and icon
- **Settings**: medium gray background with a large light gray gear in center
- **Music**: salmonish-color with a large music note in the center
- **App Store**: a giant white A on a blue background

## New Icons (February 2026)
- **Arcade**: orange/coral gradient with white game controller icon ✓
- **Computers**: blue/charcoal gradient with desktop monitor and laptop ✓
- **Movies**: deep red gradient with white clapperboard icon ✓
- **Photos**: white background with multicolored flower/pinwheel (Apple Photos style) ✓
- **Search**: light blue gradient with white magnifying glass ✓
- **TV Shows**: purple/blue gradient with TV screen and play button ✓

## Icon Files
All PNG icons (512x512) are located in \`extension/icons/apps/\` with bundle ID naming:
- com.apple.Arcade.png
- com.apple.TVAppStore.png
- com.apple.TVHomeSharing.png (Computers)
- com.apple.TVMovies.png
- com.apple.TVMusic.png
- com.apple.TVPhotos.png
- com.apple.TVSearch.png
- com.apple.TVSettings.png
- com.apple.TVShows.png
- com.apple.TVWatchList.png (TV)

SVG source files are in \`system_icons/\` directory for future editing.
- arcade.svg
- computers.svg
- movies.svg
- photos.svg
- search.svg
- tvshows.svg

## Design Guidelines
- Size: 512x512 pixels
- Format: PNG with transparency support
- Corner radius: 90px (matching iOS/tvOS rounded corners)
- Style: Flat design with gradients or solid colors
- Icons should be simple and match Apple's design language

## Important Note
Icon filenames must match the app's bundle ID exactly for \`getAppIconSync\` to find them.
The bundle ID lookup order in extension.js is:
1. \`extension/icons/apps/{bundleId}.png\`
2. \`extension/icons/apps/{appName.toLowerCase()}.png\` (fallback)
3. \`~/.config/appletv-remote/icons/{bundleId}.png\` (cached downloaded)
