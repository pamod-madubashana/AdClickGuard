# Ad Click Guard Browser Extension

A Chrome/Chromium extension that protects users from accidental ad clicks on short-link websites.

## Features

- **Ad Protection**: Places semi-transparent red overlays over detected ads to prevent accidental clicks
- **Countdown Detection**: Identifies countdown timers and highlights them for user attention
- **Button Guidance**: Detects and highlights important action buttons like "Continue" and "Verify"
- **Dynamic Content Support**: Uses MutationObserver to handle dynamically loaded content
- **Toggle Control**: Simple on/off toggle via popup interface
- **Non-Intrusive**: Does not block ads entirely, only prevents accidental clicks

## Installation

1. Open Chrome/Chromium and navigate to `chrome://extensions`
2. Enable "Developer mode" in the top right corner
3. Click "Load unpacked" and select the extension directory
4. The extension icon should appear in your browser toolbar

## How to Use

1. Click the extension icon in your browser toolbar
2. Toggle the "Ad Click Guard" switch to enable/disable protection
3. When enabled, the extension will automatically:
   - Overlay ads with a semi-transparent red shield
   - Highlight countdown timers with a pulsing effect
   - Highlight action buttons with a glowing effect
   - Scroll important elements into view

## Technical Details

### Files Structure
- `manifest.json` - Extension manifest for Chrome
- `content.js` - Core functionality for ad detection and overlay
- `content.css` - Styling for overlays and highlights
- `popup/` - Directory containing popup UI
  - `popup.html` - Popup interface structure
  - `popup.js` - Popup functionality
  - `popup.css` - Popup styling
- `icons/` - Extension icons (icon16.png, icon48.png, icon128.png)

### Detection Methods
- **Ads**: Detected by common ad-related IDs, classes, and content
- **Countdowns**: Identified by text patterns and timer-related elements
- **Action Buttons**: Found using common button text and attributes

### Permissions
- `activeTab`: To access the currently active tab
- `scripting`: To inject content scripts

## Customization

The extension behavior can be customized by modifying:
- Overlay opacity and color in `content.js`
- Animation styles in `content.css`
- Detection patterns in `content.js`

## Important Notes

- The extension does not bypass ad network logic
- Users must still manually click on action buttons after countdowns
- Designed to work with dynamic content and single-page applications
- Compatible with Chrome Extension Manifest V3

## Testing

To test the extension:
1. Visit short-link websites or pages with ads
2. Enable the extension
3. Verify that ads are properly overlaid
4. Check that countdowns and action buttons are highlighted
5. Ensure normal page functionality remains intact