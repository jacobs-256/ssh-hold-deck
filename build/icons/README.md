# Desktop Application Icons

`default/` contains the original dark application icon and is recommended for packaging.
`light/` and `dark/` contain the matching web theme variants, exported in the same formats.
All PNG files have transparent corners, rendered directly from the SVG source.

| Platform | Recommended file | Contents |
| --- | --- | --- |
| Windows | `default/icon.ico` | 16, 24, 32, 48, 64, 128, 256 px frames |
| macOS | `default/icon.icns` | Standard 16 through 512 pt, including @2x up to 1024 px |
| Linux | `default/icon.png` or size-specific PNG | 16, 24, 32, 48, 64, 128, 256, 512, 1024 px |
| Linux scalable | `default/icon.svg` | Original vector source |

For Electron Builder, set `win.icon` to `build/icons/default/icon.ico`,
`mac.icon` to `build/icons/default/icon.icns`, and `linux.icon` to
`build/icons/default/` (or a specific PNG).

For Tauri, list the ICO, ICNS and selected PNG paths in `bundle.icon`.
Paths are relative to the packaging configuration directory; adjust them to its location.
These files do not add desktop packaging or native Windows support to the application.

To regenerate, make the `sharp` Node.js package available, then run:

```sh
node scripts/generate-desktop-icons.cjs
```

PNG and ICO generation works across platforms. ICNS generation requires macOS
with `iconutil`; the portable `icon.iconset/` source is generated on all platforms.
The supplied ICNS files are already generated and ready to use.
