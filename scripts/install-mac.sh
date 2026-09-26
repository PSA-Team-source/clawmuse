#!/bin/sh
# Installs (or updates) the latest ClawMuse release on macOS.
#
#   curl -fsSL https://clawmuse.app/install.sh | sh
#
# Downloads the DMG for this Mac from the latest GitHub release, checks it
# against that release's SHA256SUMS.txt, copies ClawMuse.app into
# /Applications (or ~/Applications when /Applications is not writable) and
# opens it. Mac releases are Developer ID signed + notarized, so the browser
# download opens on its own; this script is a convenience (and still installs
# an ad-hoc signed local build, since curl sets no quarantine flag).
#
# Everything runs inside main(), so a truncated download of this script
# executes nothing.

set -eu

REPO="PSA-Team-source/clawmuse"
BASE="https://github.com/$REPO/releases/latest/download"
APP="ClawMuse.app"
BUNDLE_ID="ai.clawmuse.desktop"

say() { printf '%s\n' "$*"; }
die() { printf 'ClawMuse install: %s\n' "$*" >&2; exit 1; }

fetch() { # url dest
  curl -fL --proto '=https' --tlsv1.2 --retry 3 --progress-bar -o "$2" "$1" \
    || die "could not download $1"
}

main() {
  [ "$(uname -s)" = "Darwin" ] || die "this installer is for macOS; Windows installers are at https://clawmuse.app/download"
  major=$(sw_vers -productVersion | cut -d. -f1)
  [ "$major" -ge 12 ] || die "ClawMuse needs macOS 12 or later (this Mac runs $(sw_vers -productVersion))"

  # uname -m says x86_64 under Rosetta, so ask the hardware.
  if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then arch=arm64; else arch=x64; fi

  tmp=$(mktemp -d "${TMPDIR:-/tmp}/clawmuse-install.XXXXXX")
  mnt="$tmp/mnt"
  trap 'hdiutil detach -quiet "$mnt" >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT INT TERM

  say "Finding the latest ClawMuse release…"
  fetch "$BASE/SHA256SUMS.txt" "$tmp/SHA256SUMS.txt"
  line=$(grep -E "  ClawMuse-[0-9][^ ]*-$arch\.dmg\$" "$tmp/SHA256SUMS.txt" | head -n 1 || true)
  [ -n "$line" ] || die "the latest release has no $arch Mac installer"
  dmg=${line##* }
  sum=${line%% *}
  version=$(printf '%s' "$dmg" | sed -E "s/^ClawMuse-(.*)-$arch\.dmg\$/\1/")

  say "Downloading ClawMuse $version ($arch)…"
  fetch "$BASE/$dmg" "$tmp/$dmg"
  [ "$(shasum -a 256 "$tmp/$dmg" | cut -d' ' -f1)" = "$sum" ] \
    || die "checksum mismatch for $dmg — the download is corrupt or was tampered with; nothing was installed"
  say "Checksum verified."

  mkdir -p "$mnt"
  hdiutil attach -quiet -nobrowse -readonly -noautoopen -mountpoint "$mnt" "$tmp/$dmg" \
    || die "could not open $dmg"
  [ -d "$mnt/$APP" ] || die "$dmg does not contain $APP"
  codesign --verify --deep --strict "$mnt/$APP" 2>/dev/null \
    || die "$APP in $dmg fails its signature check; nothing was installed"

  dest=/Applications
  if [ ! -w "$dest" ] || { [ -e "$dest/$APP" ] && [ ! -w "$dest/$APP" ]; }; then
    dest="$HOME/Applications"
    mkdir -p "$dest"
  fi

  # Match the app window process only: the background gateway runs the same
  # binary with arguments and keeps running across the swap.
  running() { pgrep -qf "/$APP/Contents/MacOS/ClawMuse\$"; }
  if running; then
    say "Quitting the running ClawMuse…"
    osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
    i=0
    while running && [ $i -lt 20 ]; do sleep 0.5; i=$((i + 1)); done
  fi

  # Copy next to the target first, then swap, so a failed copy never leaves
  # the Mac without a working app.
  rm -rf "$dest/.$APP.installing"
  ditto "$mnt/$APP" "$dest/.$APP.installing" || die "could not copy $APP into $dest"
  rm -rf "${dest:?}/$APP"
  mv "$dest/.$APP.installing" "$dest/$APP"
  xattr -dr com.apple.quarantine "$dest/$APP" 2>/dev/null || true

  say "Installed ClawMuse $version in $dest."
  open "$dest/$APP"
}

main "$@"
