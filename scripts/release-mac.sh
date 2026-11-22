#!/usr/bin/env bash
# Build, sign (Developer ID: Digital Vibes GmbH), notarize and publish the macOS build.
# Windows and Linux are built by .github/workflows/release.yml when the tag is pushed.
#
#   pnpm release:mac          # full release of the version in tauri.conf.json
#   SKIP_UPLOAD=1 pnpm release:mac
#   NOTARIZE=0 pnpm release:mac   # signed only, quick local test
#
# Needs: the Developer ID certificate in the login keychain, the notarytool keychain profile
# "splatcraft" (xcrun notarytool store-credentials splatcraft --apple-id <id> --team-id 8HFX6YPXXN),
# the updater key at ~/.tauri/appetizer.key and rustup targets aarch64 + x86_64-apple-darwin.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH" # rustup's cargo, which has both Mac targets

REPO="fabianfreund/Appetizer-launcher"
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
TAG="v$VERSION"
PROFILE="${APPLE_KEYCHAIN_PROFILE:-splatcraft}"
export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-Developer ID Application: Digital Vibes GmbH (8HFX6YPXXN)}"
export TAURI_SIGNING_PRIVATE_KEY="$(cat "${TAURI_KEY:-$HOME/.tauri/appetizer.key}")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
# Tauri would notarize itself if these were set; we do it below with the keychain profile instead.
unset APPLE_ID APPLE_PASSWORD APPLE_API_KEY APPLE_API_ISSUER

if [[ -z "${ALLOW_DIRTY:-}" && -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit first." >&2; exit 1
fi
for f in package.json src-tauri/Cargo.toml; do
  grep -q "\"version\": \"$VERSION\"\|^version = \"$VERSION\"" "$f" || { echo "$f is not at $VERSION" >&2; exit 1; }
done

echo "▸ Appetizer $TAG (universal)"
pnpm install --frozen-lockfile
pnpm tauri build --target universal-apple-darwin --bundles app,dmg

BUNDLE=src-tauri/target/universal-apple-darwin/release/bundle
APP="$BUNDLE/macos/Appetizer.app"
DMG_SRC=$(ls "$BUNDLE"/dmg/*.dmg | head -1)
OUT=$(mktemp -d)
DMG="$OUT/Appetizer_${VERSION}_universal.dmg"
TARBALL="$OUT/Appetizer_universal.app.tar.gz"

notarize() { # file
  echo "▸ Notarizing $(basename "$1")"
  xcrun notarytool submit "$1" --keychain-profile "$PROFILE" --wait | tee "$OUT/notary.log"
  grep -q "status: Accepted" "$OUT/notary.log" || { echo "Notarization failed" >&2; exit 1; }
}

codesign --verify --deep --strict "$APP"
if [[ "${NOTARIZE:-1}" != "0" ]]; then
  ditto -c -k --keepParent "$APP" "$OUT/app.zip"
  notarize "$OUT/app.zip"
  xcrun stapler staple "$APP"
fi

# Updater bundle from the stapled app, signed with the updater key.
# No AppleDouble "._*" entries: macOS tar adds them for xattrs and the Tauri updater can't unpack them.
COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs -czf "$TARBALL" -C "$(dirname "$APP")" Appetizer.app
python3 -I -c '
import sys, tarfile
bad = [m.name for m in tarfile.open(sys.argv[1]).getmembers() if m.name.rsplit("/", 1)[-1].startswith("._")]
sys.exit(f"Updater bundle contains AppleDouble files: {bad[:3]}" if bad else 0)
' "$TARBALL"
pnpm tauri signer sign "$TARBALL" >/dev/null
SIG=$(cat "$TARBALL.sig")

cp "$DMG_SRC" "$DMG"
if [[ "${NOTARIZE:-1}" != "0" ]]; then
  notarize "$DMG"
  xcrun stapler staple "$DMG"
  spctl -a -t exec -vv "$APP"
fi
ls -lh "$DMG" "$TARBALL"
[[ -n "${SKIP_UPLOAD:-}" ]] && { echo "Artifacts in $OUT"; exit 0; }

# Tag → CI builds Windows/Linux and publishes. Wait for it so its latest.json is final.
if ! git rev-parse "$TAG" >/dev/null 2>&1; then git tag -a "$TAG" -m "Appetizer $TAG"; fi
git push origin "$TAG"
echo "▸ Waiting for the Windows/Linux build of $TAG"
sleep 10
RUN=$(gh run list -R "$REPO" --workflow release.yml --branch "$TAG" --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" -R "$REPO" --exit-status >/dev/null

gh release upload "$TAG" -R "$REPO" "$DMG" "$TARBALL" "$TARBALL.sig" --clobber

# Add macOS to latest.json (one universal build serves both architectures).
gh release download "$TAG" -R "$REPO" -p latest.json -D "$OUT" --clobber
URL="https://github.com/$REPO/releases/download/$TAG/$(basename "$TARBALL")"
SIG="$SIG" URL="$URL" node -e '
  const fs = require("fs"), f = process.argv[1], j = JSON.parse(fs.readFileSync(f, "utf8"));
  for (const p of ["darwin-aarch64", "darwin-x86_64", "darwin-aarch64-app", "darwin-x86_64-app"])
    j.platforms[p] = { signature: process.env.SIG, url: process.env.URL };
  fs.writeFileSync(f, JSON.stringify(j, null, 2));
' "$OUT/latest.json"
gh release upload "$TAG" -R "$REPO" "$OUT/latest.json" --clobber
echo "✓ Released $TAG: https://github.com/$REPO/releases/tag/$TAG"
