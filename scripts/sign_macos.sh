#!/usr/bin/env bash
# Code-signing stub for Qimchi macOS builds.
#
# Internal / development builds: exits immediately — signing is skipped.
# Distribution builds (App Store / notarization): obtain a "Developer ID
# Application" certificate, add it to your Keychain, fill in the constants
# below, and remove the early-exit.
#
# Usage (from qimchi-react/):
#   bash scripts/sign_macos.sh packaging/build/qimchi.app packaging/build/qimchi.dmg

echo "Code signing skipped — no Developer ID certificate configured (internal build)."
echo "See scripts/sign_macos.sh for the commands needed for distribution signing."
exit 0

# ── Distribution signing (unreachable — shown for reference) ─────────────────

APP="${1:?Usage: sign_macos.sh <path/to/qimchi.app> <path/to/qimchi.dmg>}"
DMG="${2:?Usage: sign_macos.sh <path/to/qimchi.app> <path/to/qimchi.dmg>}"

# Fill these in when a cert is available.
IDENTITY="Developer ID Application: <Name or Org> (<TEAM_ID>)"
ENTITLEMENTS="packaging/entitlements.plist"

# 1. Sign the .app with the hardened runtime (required for notarization).
#    entitlements.plist must grant:
#      com.apple.security.cs.allow-unsigned-executable-memory = true
#    because Python executes JIT-compiled bytecode.
codesign \
    --deep \
    --force \
    --verify \
    --verbose \
    --sign "$IDENTITY" \
    --options runtime \
    --entitlements "$ENTITLEMENTS" \
    "$APP"

codesign --verify --deep --strict --verbose=2 "$APP"
spctl --assess --type exec --verbose "$APP"

# 2. Notarize the DMG (credentials via Keychain or env vars).
xcrun notarytool submit "$DMG" \
    --apple-id   "$APPLE_ID" \
    --password   "$APPLE_APP_PASSWORD" \
    --team-id    "$APPLE_TEAM_ID" \
    --wait

# 3. Staple the notarization ticket so the .dmg passes Gatekeeper offline.
xcrun stapler staple "$DMG"

# ── Sample entitlements.plist ─────────────────────────────────────────────────
# Save as packaging/entitlements.plist when enabling signing:
#
# <?xml version="1.0" encoding="UTF-8"?>
# <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
#   "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
# <plist version="1.0"><dict>
#   <!-- Python needs this for the eval loop / bytecode JIT -->
#   <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
#   <!-- Outbound network access (GitLab update check, Kaleido Chrome download) -->
#   <key>com.apple.security.network.client</key><true/>
# </dict></plist>
