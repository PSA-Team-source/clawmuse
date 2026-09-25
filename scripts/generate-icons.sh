#!/usr/bin/env bash
# Regenerates every macOS icon artefact from the two brand PNGs in resources/.
# Source of truth: resources/icon.png (full-colour mark, 1024²) and
# resources/glyph.png (white claw-and-spark on transparent, 1024²), rendered
# from resources/icon.svg and resources/glyph.svg — edit the SVGs, re-render
# the two PNGs at 1024², then run this script.
#
# Produces four artefacts, because macOS 26, macOS 15 and `electron-vite dev`
# each resolve an app icon by an entirely different mechanism:
#   build/icon.icon   → Icon Composer package; electron-builder compiles it with
#                       actool into Assets.car + CFBundleIconName. This is the
#                       ONLY path macOS 26 treats as a first-class icon.
#   build/icon.icns   → legacy raster icon for macOS 15 and earlier, which read
#                       CFBundleIconFile and know nothing about Assets.car.
#   build/dock-dev.png→ macOS's own render of the composed icon, for
#                       app.dock.setIcon() in dev (see step 3). Not packaged.
#   resources/*.png   → tray template + notification icon (plain images, no
#                       bundle-icon machinery involved).
#
# Requires: ImageMagick (`brew install imagemagick`), and Xcode 26 or newer for
# iconutil, actool and swift.
set -euo pipefail

cd "$(dirname "$0")/.."

ICON_SRC="resources/icon.png"
GLYPH_SRC="resources/glyph.png"

[ -f "$ICON_SRC" ] || { echo "missing $ICON_SRC" >&2; exit 1; }
[ -f "$GLYPH_SRC" ] || { echo "missing $GLYPH_SRC" >&2; exit 1; }

# The brand mark is used exactly as icon.png draws it — same background colour,
# same glyph, same proportions. Both are measured off icon.png rather than
# hardcoded, so a mobile-side artwork change flows through here automatically.
CANVAS=1024
BG="$(magick "$ICON_SRC" -format '%[pixel:p{5,5}]' info:)"
# Height of the glyph inside icon.png, so the layer built for the .icon package
# below reproduces mobile's framing instead of inventing its own.
# Geometry of the glyph inside icon.png ("478x637+322+174"), so the layer built
# for the .icon package below reproduces mobile's framing — including the slight
# downward offset — instead of inventing its own.
# Measured off the transparent glyph.png, which carries the glyph alone.
GLYPH_GEOM="$(magick "$GLYPH_SRC" -trim -format '%wx%h%X%Y' info:)"
GLYPH_H="${GLYPH_GEOM%%+*}"; GLYPH_H="${GLYPH_H#*x}"
GLYPH_OFF="${GLYPH_GEOM#*+}"; GLYPH_X="${GLYPH_OFF%%+*}"; GLYPH_Y="${GLYPH_OFF#*+}"

# The shaped icon every non-Assets.car surface needs: the artwork on Apple's
# 824pt grid inside the 1024 canvas, masked to a rounded square, with the soft
# system shadow. A full-bleed square .icns is not "an icon" to macOS 26: it
# puts it in a grey rounded-square jail, and older macOS shows a hard square.
# (`-alpha set` matters: icon.png is opaque, and DstIn on an image without an
# alpha channel paints the corners black instead of clearing them.)
SHAPED_DIR="$(mktemp -d)"
SHAPED="$SHAPED_DIR/shaped.png"
magick -size 824x824 xc:none -fill white -draw "roundrectangle 0,0 823,823 186,186" "$SHAPED_DIR/mask.png"
magick "$ICON_SRC" -alpha set -resize 824x824 "$SHAPED_DIR/mask.png" -compose DstIn -composite -compose Over \
  \( "$SHAPED_DIR/mask.png" -background black -shadow 35x14+0+12 \) +swap -background none -layers merge +repage \
  -gravity center -background none -extent "${CANVAS}x${CANVAS}" \
  "$SHAPED"
trap 'rm -rf "$SHAPED_DIR"' EXIT

# ── 0. build/icon.ico — the Windows app/installer icon ───────────────────────
# Windows 11 icons are rounded squares filling the canvas (no macOS grid inset
# or shadow — the shell draws none of that), at every size Explorer asks for.
magick "$ICON_SRC" -alpha set \( -size ${CANVAS}x${CANVAS} xc:none -fill white -draw "roundrectangle 0,0 $((CANVAS - 1)),$((CANVAS - 1)) 180,180" \) -compose DstIn -composite \
  -define icon:auto-resize=256,128,64,48,40,32,24,20,16 build/icon.ico

# ── 1. build/icon.icns — the .app bundle icon ────────────────────────────────
ICONSET="$(mktemp -d)/ClawMuse.iconset"
mkdir -p "$ICONSET"
for size in 16 32 64 128 256 512; do
  magick "$SHAPED" -resize "${size}x${size}" "$ICONSET/icon_${size}x${size}.png"
  magick "$SHAPED" -resize "$((size * 2))x$((size * 2))" "$ICONSET/icon_${size}x${size}@2x.png"
done
# iconutil insists on a 512@2x (=1024) entry for a complete set.
cp "$SHAPED" "$ICONSET/icon_512x512@2x.png"
mkdir -p build
iconutil --convert icns --output build/icon.icns "$ICONSET"
rm -rf "$(dirname "$ICONSET")"

# ── 2. build/icon.icon — the Icon Composer package macOS 26 actually wants ───
# macOS 26 resolves app icons through CFBundleIconName → a layered asset in
# Assets.car. An .icns only satisfies the compatibility path, which renders the
# artwork flat: no depth, no specular highlight, and no dark/tinted/clear
# appearances. electron-builder (>= 26.2.0) compiles this package with actool
# and writes both Assets.car and CFBundleIconName into the bundle.
#
# The format is a plain directory — a JSON manifest plus layer images — so it is
# authored here in script rather than in Icon Composer.app, which keeps the icon
# reproducible from the brand PNGs like every other artefact in this file.
#
# Layers are exported edge-to-edge with NO mask baked in: macOS applies the
# superellipse itself, and a pre-drawn one would be masked twice.
ICON_PKG="build/icon.icon"
rm -rf "$ICON_PKG"
mkdir -p "$ICON_PKG/Assets"

# The background is the manifest's `fill`, so the layer carries the glyph alone,
# sized to GLYPH_H — the glyph's height in icon.png — so the composed icon is
# pixel-for-pixel the mobile artwork, just rendered through the macOS 26 layer
# pipeline instead of baked flat.
magick "$GLYPH_SRC" -trim +repage \
  -resize "x${GLYPH_H}" \
  -background none -gravity NorthWest -extent "${CANVAS}x${CANVAS}-${GLYPH_X}-${GLYPH_Y}" \
  -colorspace sRGB -depth 8 -strip \
  "$ICON_PKG/Assets/glyph.png"

# `fill` wants normalised sRGB components, but the brand colour is sampled as
# 8-bit above — convert rather than hardcode, so both stay in sync.
FILL="$(magick "$ICON_SRC" -format 'srgb:%[fx:floor(p{5,5}.r*100000)/100000],%[fx:floor(p{5,5}.g*100000)/100000],%[fx:floor(p{5,5}.b*100000)/100000],1.00000' info:)"

cat > "$ICON_PKG/icon.json" <<JSON
{
  "fill" : {
    "solid" : "${FILL}"
  },
  "groups" : [
    {
      "blur-material" : null,
      "layers" : [
        {
          "glass" : false,
          "hidden" : false,
          "image-name" : "glyph.png",
          "name" : "glyph",
          "position" : {
            "scale" : 1,
            "translation-in-points" : [
              0,
              0
            ]
          }
        }
      ],
      "lighting" : "individual",
      "shadow" : {
        "kind" : "neutral",
        "opacity" : 0.5
      },
      "specular" : true,
      "translucency" : {
        "enabled" : false,
        "value" : 0.5
      }
    }
  ],
  "supported-platforms" : {
    "circles" : [
      "watchOS"
    ],
    "squares" : "shared"
  }
}
JSON

# ── 3. build/dock-dev.png — the Dock icon while running `npm run dev` ────────
# `electron-vite dev` executes node_modules/electron/dist/Electron.app, and
# macOS takes a Dock icon from the *running* bundle's Info.plist — which points
# at electron.icns. So dev shows the Electron logo no matter what
# electron-builder is configured to do, and app.dock.setIcon() is the only
# runtime override. It wants a plain image.
#
# That image has to be the *composed* icon, not the source artwork: macOS 26
# applies the superellipse mask, the icon-grid inset, per-layer specular
# lighting and the drop shadow itself, at display time, from the layers in
# Assets.car. None of it is reproducible with an image editor. So compile a real
# Assets.car, wrap it in a throwaway .app, and let AppKit render that — the
# result is pixel-identical (verified: ImageMagick AE = 0) to the icon the
# shipped ClawMuse.app shows.
#
# The actool invocation is copied verbatim from app-builder-lib's
# macosIconComposer, so what dev displays cannot drift from what electron-builder
# compiles at package time. That includes copying the package to `Icon.icon`:
# `--app-icon Icon` matches on basename, and against our lowercase `icon.icon`
# actool exits 0 having emitted nothing at all.
if xcrun --find actool >/dev/null 2>&1 && xcrun --find swift >/dev/null 2>&1; then

DOCK_TMP="$(mktemp -d)"
cp -R "$ICON_PKG" "$DOCK_TMP/Icon.icon"
mkdir -p "$DOCK_TMP/car"
xcrun actool "$DOCK_TMP/Icon.icon" \
  --compile "$DOCK_TMP/car" \
  --output-format human-readable-text \
  --notices \
  --warnings \
  --output-partial-info-plist "$DOCK_TMP/car/assetcatalog_generated_info.plist" \
  --app-icon Icon \
  --include-all-app-icons \
  --accent-color AccentColor \
  --enable-on-demand-resources NO \
  --development-region en \
  --target-device mac \
  --minimum-deployment-target 26.0 \
  --platform macosx >"$DOCK_TMP/actool.log" 2>&1 \
  || { cat "$DOCK_TMP/actool.log" >&2; rm -rf "$DOCK_TMP"; exit 1; }

# actool reports the silent no-op above as success, so check the artefact.
[ -f "$DOCK_TMP/car/Assets.car" ] || {
  cat "$DOCK_TMP/actool.log" >&2
  echo "actool emitted no Assets.car — is $ICON_PKG a valid Icon Composer package?" >&2
  rm -rf "$DOCK_TMP"
  exit 1
}

STUB="$DOCK_TMP/DockDev.app"
mkdir -p "$STUB/Contents/MacOS" "$STUB/Contents/Resources"
cp "$DOCK_TMP/car/Assets.car" "$STUB/Contents/Resources/Assets.car"
# NSWorkspace only reads the bundle — this executable never runs — but Info.plist
# has to name one for the directory to be treated as an app at all. The bundle id
# is deliberately not the real app's, so Launch Services never conflates the two.
printf '#!/bin/sh\nexit 0\n' > "$STUB/Contents/MacOS/DockDev"
chmod +x "$STUB/Contents/MacOS/DockDev"
cat > "$STUB/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>DockDev</string>
  <key>CFBundleIdentifier</key><string>ai.clawmuse.desktop.dockdev</string>
  <key>CFBundleName</key><string>DockDev</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconName</key><string>Icon</string>
  <key>LSMinimumSystemVersion</key><string>26.0</string>
</dict></plist>
PLIST

# Launch Services answers icon queries from its own registry, and for a bundle it
# has not seen it hands back the generic document placeholder — successfully.
# The mktemp path above is new every run, so this is mostly a formality, but the
# failure mode is silent and ships a picture of a blank sheet of paper.
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister
[ -x "$LSREGISTER" ] && "$LSREGISTER" -f "$STUB" 2>/dev/null || true

# Written straight from AppKit with no post-processing: re-encoding through
# ImageMagick to save a few KB would risk a colour shift in the one artefact
# whose whole purpose is matching the shipped icon exactly. The brand colour is
# passed so the renderer can prove it got the real icon rather than a
# placeholder — see the verification in render-app-icon.swift.
BRAND_HEX="$(magick "$ICON_SRC" -format '%[hex:p{5,5}]' info: | cut -c1-6)"
swift scripts/render-app-icon.swift "$STUB" build/dock-dev.png "$BRAND_HEX" || {
  rm -rf "$DOCK_TMP"
  exit 1
}
rm -rf "$DOCK_TMP"
else
  # Command Line Tools only (no Xcode 26): no actool, so no composed render.
  # The shaped icon above (824pt grid, rounded mask, soft shadow) is what dev
  # shows instead — the same artwork the .icns carries.
  echo "! no Xcode 26 (actool) — build/dock-dev.png rendered with ImageMagick instead" >&2
  cp "$SHAPED" build/dock-dev.png
fi

# ── 4. resources/trayTemplate*.png — menu bar glyph ──────────────────────────
# macOS template images must be a black shape carried by the alpha channel; the
# system recolours them for light/dark menu bars and for the "selected" state.
# The source glyph is white-on-transparent, so force RGB to black and keep alpha.
# Trimmed to the mark and sized to the menu bar's 18pt height: resizing the
# whole 1024 canvas kept the icon-grid padding, and the claw came out tiny.
for spec in "18:trayTemplate.png" "36:trayTemplate@2x.png" "54:trayTemplate@3x.png"; do
  size="${spec%%:*}"; out="${spec##*:}"
  magick "$GLYPH_SRC" \
    -channel RGB -evaluate set 0 +channel \
    -trim +repage \
    -resize "x${size}" \
    "resources/$out"
done

echo "✓ build/icon.ico     (Windows)"
echo "✓ build/icon.icns    (macOS 15 and earlier)"
echo "✓ build/icon.icon    (macOS 26+, compiled to Assets.car at package time)"
echo "✓ build/dock-dev.png (Dock icon for \`npm run dev\`)"
echo "✓ resources/trayTemplate.png, @2x, @3x"
