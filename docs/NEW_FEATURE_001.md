# NEW_FEATURE_001: Dynamic App Button Colors from Logo

## Goal

Fetch dominant colors from each app's logo and use them to style app buttons (background + text) instead of the current static CSS fallback.

## Approach

1. **Search for the app icon** using `ddgs` (DuckDuckGo image search):
   - Query: `+"<app name>" site:apps.apple.com`
   - Grab the first result image.

2. **Extract two dominant colors** from the icon:
   - Ignore any color outside the rounded-square icon boundary.
   - Sample the two most prominent colors.
   - Use the first as the button background, the second as the button text color.

3. **Ensure contrast** — adjust the pair if they don't meet a minimum contrast ratio.

4. **Background daemon** fetches colors incrementally:
   - Start with favorites, then the rest alphabetically.
   - Persist colors to disk so each app is only fetched once.
   - Update button styles live as colors arrive.
