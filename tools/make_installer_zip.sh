#!/bin/bash
# Build a zip you can hand a colleague: inside is a double-clickable
# "Install Budget Primer Editor.app" and a two-line README. Opening the app
# opens a Terminal window that runs the one-line installer (the same
# install.sh everyone uses, fetched fresh from GitHub) with the live report
# preset — so the person ends up with the editor, the real Budget Primer,
# and the Dock app, having typed nothing.
#
#   ./tools/make_installer_zip.sh                  # editor only (the default)
#   ./tools/make_installer_zip.sh owner/live-repo  # ALSO set up that report
#
# The zip is deliberately TINY and never stale: it carries no code of its
# own beyond the bootstrap, because the installer it runs is whatever is on
# main the day it is double-clicked. The one thing the recipient may hit is
# Gatekeeper — the app is unsigned — and README.txt inside says exactly what
# to click when that happens.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
# No live repo by default: the editor stands alone, working immediately with
# its bundled demo and "+ New report". A specific report repo is opt-in — the
# recipient can always add one themselves later (start page > Adopt existing,
# or re-run the installer line with PRIMER_LIVE).
LIVE="${1:-}"
INSTALL_URL="${PRIMER_INSTALL_URL:-https://raw.githubusercontent.com/Hawaii-Appleseed/Cider/main/install.sh}"

DIST="$REPO/dist"
STAGE="$DIST/Budget Primer Editor Installer"
APP="$STAGE/Install Budget Primer Editor.app"
ZIP="$DIST/Budget-Primer-Editor-Installer.zip"

rm -rf "$STAGE" "$ZIP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# --- what actually runs, in a visible Terminal window ------------------------
# A .command opened by Terminal, so the person SEES the install happen —
# a silent background installer that either works or vanishes is how you
# lose someone's trust on the first double-click.
cat > "$APP/Contents/Resources/run-install.command" <<CMD
#!/bin/bash
clear
echo "  Budget Primer Editor — installing."
echo "  This fetches the editor from GitHub — a couple of minutes"
echo "  on a normal connection."
echo
$( [ -n "$LIVE" ] && echo "export PRIMER_LIVE=\"$LIVE\"" )
if bash -c "\$(curl -fsSL $INSTALL_URL)"; then
  open "\$HOME/Applications/Budget Primer Editor.app" 2>/dev/null || true
  echo
  echo "  Done — the editor is opening. It lives in ~/Applications;"
  echo "  drag it to the Dock. You can close this window."
else
  echo
  echo "  Something failed — the messages above say what. It is safe to"
  echo "  double-click the installer again after fixing it."
fi
echo
read -r -p "  Press Return to close this window. "
CMD
chmod +x "$APP/Contents/Resources/run-install.command"

# --- the app is just a hand that opens that script in Terminal ---------------
cat > "$APP/Contents/MacOS/launch" <<'LAUNCH'
#!/bin/bash
exec open -a Terminal "$(cd "$(dirname "$0")/../Resources" && pwd)/run-install.command"
LAUNCH
chmod +x "$APP/Contents/MacOS/launch"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Install Budget Primer Editor</string>
  <key>CFBundleIdentifier</key><string>org.hiappleseed.primereditor.installer</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# Same icon as the editor, so the pair read as one thing.
SRC_PNG="$REPO/docs/primer/icons/icon-512.png"
if [ -f "$SRC_PNG" ] && command -v iconutil >/dev/null 2>&1; then
  ICONSET="$(mktemp -d)/icon.iconset"
  mkdir -p "$ICONSET"
  for spec in "16:16x16" "32:32x32" "128:128x128" "256:256x256" "512:512x512"; do
    px="${spec%%:*}"; name="${spec##*:}"
    sips -z "$px" "$px" "$SRC_PNG" --out "$ICONSET/icon_$name.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/icon.icns"
  rm -rf "$(dirname "$ICONSET")"
fi

# Ad-hoc signature: not notarization, but it keeps the bundle's own pieces
# consistent so Gatekeeper's complaint is the standard one README.txt answers.
codesign --force --deep -s - "$APP" >/dev/null 2>&1 || true

cat > "$STAGE/README.txt" <<'TXT'
Budget Primer Editor — install

1.  Double-click "Install Budget Primer Editor".
2.  If macOS says it can't check the app for malware:
      right-click the app, choose Open, then Open again
    — or on newer macOS: System Settings > Privacy & Security,
      scroll down, click "Open Anyway".
3.  A Terminal window shows the install (a couple of minutes).
    When it finishes the editor opens by itself.

Afterwards the editor lives in ~/Applications as
"Budget Primer Editor" — drag it to the Dock. Opening it always
brings you back to your work, and it keeps itself up to date.

You start with the editor itself: the bundled demo, and
"+ New report" for a blank page of your own — no accounts needed.

To work on a SPECIFIC report later (for example the live Budget
Primer), ask whoever sent you this for the repo name, then either
re-run their install line with PRIMER_LIVE=owner/repo, or clone
the repo and use the editor's start page > "Adopt existing…".

To PUSH edits to a website you also need access to that repo —
File > Connect GitHub inside the editor signs this computer in.
(Saving works without any of that; your edits are never lost.)
TXT

( cd "$DIST" && ditto -c -k --keepParent "$(basename "$STAGE")" "$(basename "$ZIP")" )
rm -rf "$STAGE"

echo "Built: $ZIP"
echo "Live repo preset: ${LIVE:-none — editor only}"
echo "Send the zip; the recipient double-clicks the app inside."
