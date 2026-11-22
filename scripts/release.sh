#!/bin/sh
# Builds a release of the companion for Apple Silicon, signed with Developer ID and
# notarized:
#   dist/zen-<version>-darwin-arm64.tar.gz   for Homebrew (Formula/zen.rb in daniguardiola/homebrew-tap)
#   dist/zen.dmg                             zen.app, a menu bar app, for everyone else
#   dist/SHA256SUMS
#
# Signing uses the "Developer ID Application" identity in your keychain. Notarizing uses
# a notarytool keychain profile (default name "zen"), created once with:
#   xcrun notarytool store-credentials zen --key <AuthKey.p8> --key-id <id> --issuer <issuer>
# Without that profile everything is still signed, but not notarized (fine for testing).
set -eu
cd "$(dirname "$0")/.."
version=$(bun -e 'console.log(require("./companion/package.json").version)')
profile=${ZEN_NOTARY_PROFILE:-zen}
out=dist
stage="$out/zen-$version"
rm -rf "$out" && mkdir -p "$stage/speech"

# Sign by fingerprint: codesign can misread accented names.
identity=$(security find-identity -v -p codesigning | awk '/Developer ID Application/ { print $2; exit }')
[ -n "$identity" ] || { echo "No Developer ID Application identity in the keychain" >&2; exit 1; }
notarize=1
xcrun notarytool history --keychain-profile "$profile" >/dev/null 2>&1 || {
  echo "warning: no notarytool profile \"$profile\"; building signed but NOT notarized" >&2
  notarize=0
}
sign() { codesign --force --timestamp --options runtime --sign "$identity" "$@"; }
submit() {
  [ "$notarize" = 1 ] || return 0
  xcrun notarytool submit "$1" --keychain-profile "$profile" --wait --output-format json | tee "$1.notarization.json"
  grep -q '"status" *: *"Accepted"' "$1.notarization.json" || { echo "notarization failed for $1" >&2; exit 1; }
}

# --- the companion ---------------------------------------------------------------
(cd web && bun run build)
(cd companion && bun build --compile --minify --target=bun-darwin-arm64 src/server.ts --outfile "../$stage/zen-companion")
cp -R web/dist "$stage/web"
cp speech/*.py speech/requirements.txt "$stage/speech/"
# Bun's runtime JITs: it needs these under the hardened runtime.
sign --identifier la.dio.zen.companion --entitlements macos/companion.entitlements "$stage/zen-companion"
# A bare executable can't be stapled, but notarizing it records it with Apple.
ditto -c -k "$stage/zen-companion" "$out/companion.zip" && submit "$out/companion.zip" && rm "$out/companion.zip"
tar -C "$stage" -czf "$out/zen-$version-darwin-arm64.tar.gz" .

# --- zen.app ---------------------------------------------------------------------
app="$out/zen.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
swiftc -O -target arm64-apple-macos13 macos/ZenApp.swift -o "$app/Contents/MacOS/zen"
sed "s/__VERSION__/$version/g" macos/Info.plist > "$app/Contents/Info.plist"
cp macos/AppIcon.icns "$app/Contents/Resources/"
cp -R "$stage/zen-companion" "$stage/web" "$stage/speech" "$app/Contents/Resources/"
# uv builds the voice environment on first use; ship our own so nothing else is needed.
cp "$(command -v uv)" "$app/Contents/Resources/uv"
sign --identifier la.dio.zen.uv "$app/Contents/Resources/uv"
sign --identifier la.dio.zen.companion --entitlements macos/companion.entitlements "$app/Contents/Resources/zen-companion"
sign "$app"
codesign --verify --deep --strict "$app"

# --- zen.dmg ---------------------------------------------------------------------
dmgroot="$out/dmg"
mkdir -p "$dmgroot" && cp -R "$app" "$dmgroot/" && ln -s /Applications "$dmgroot/Applications"
hdiutil create -quiet -volname zen -srcfolder "$dmgroot" -fs HFS+ -format UDZO "$out/zen.dmg"
rm -rf "$dmgroot"
codesign --force --timestamp --sign "$identity" "$out/zen.dmg"
submit "$out/zen.dmg"
[ "$notarize" = 1 ] && xcrun stapler staple "$out/zen.dmg" && xcrun stapler validate "$out/zen.dmg"

(cd "$out" && shasum -a 256 "zen-$version-darwin-arm64.tar.gz" zen.dmg > SHA256SUMS && cat SHA256SUMS)
