# SnapCraft - Element & Web Screenshot Studio

SnapCraft is a high-precision Chrome Extension (Manifest V3) designed to inspect and capture web components, full pages, or viewports, with clean export options to PNG, JPEG, WEBP, and SVG.

## Features

- **Interactive Element Inspector**: Hover over any DOM element with real-time visual outlines, dimension badges, and one-click capture.
- **Multiple Capture Modes**:
  - **Element Inspector**: Targeted DOM node capture.
  - **Visible Viewport**: Capture exactly what is visible on screen.
  - **Full Page Scroll**: Stitch entire webpage length seamlessly.
- **Multi-Format Export**: Save snapshots directly to PNG, JPEG, WEBP, or export vector structures to clean SVG.
- **Customizable Capture Settings**:
  - Device pixel ratio scaling (1x, 2x, 3x retina captures).
  - Background options (preserve transparency or solid color).
  - Margin & padding customization.
- **Built for Manifest V3**: Secure, performant, and modern extension architecture.

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/Pladd-Dot/SnapCraft.git
   ```
2. Open Google Chrome (or any Chromium-based browser) and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click **Load unpacked** and select the repository directory.
5. SnapCraft will now appear in your browser toolbar!

## Development & Testing

- Open `demo/index.html` in Chrome to test element inspection, hover outlines, and capture exports on interactive UI components.
- Icons can be regenerated using `node generate_icons.js`.

## License

MIT
