# Installer artwork

`dmg-background.svg` is the editable macOS installer background. Finder places
the actual `Qimchi.app` and Applications icons at `(200, 260)` and `(600, 260)`
in an 800 × 500 window, as configured in `../dmg-settings.py`.

After installing the frontend development dependencies and Playwright Chromium,
run `node scripts/render_dmg_artwork.mjs` from the repository root. Commit the
SVG and both generated PNGs. The macOS build uses these PNGs directly; dmgbuild
combines the 1x and 2x images into a Retina background without a Finder session.

`qimchi-macos-icon.svg` redraws the existing Qimchi mark inside a rounded white
tile. The same renderer exports its transparent 1024px PNG. Commit both files;
the macOS build uses `sips` and `iconutil` to generate all ICNS sizes for the app
and mounted disk. Icon conversion is required and stops the build on failure.
The mounted volume and Finder window are named `Qimchi`; the download filename
still includes the release version.

The renderer also writes `packaging/build/dmg-design-preview.png`. Its app and
folder overlays illustrate placement; the actual DMG uses native Finder icons
and labels. Build and inspect the final disk image on macOS.
