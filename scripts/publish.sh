#!/bin/sh
# Publishes what scripts/release.sh built: GitHub release, Homebrew formula, the page.
#   scripts/publish.sh "release notes"
set -eu
cd "$(dirname "$0")/.."
version=$(bun -e 'console.log(require("./companion/package.json").version)')
notes=${1:-"zen $version"}
tarball="zen-$version-darwin-arm64.tar.gz"
sha=$(awk -v f="$tarball" '$2 == f { print $1 }' dist/SHA256SUMS)
[ -n "$sha" ] || { echo "dist/ has no $tarball; run scripts/release.sh first" >&2; exit 1; }

gh release create "v$version" "dist/$tarball" dist/zen.dmg dist/SHA256SUMS \
  --repo DaniGuardiola/zen.dio.la --title "zen $version" \
  --notes "$notes

**Download:** [zen.dmg](https://github.com/DaniGuardiola/zen.dio.la/releases/download/v$version/zen.dmg) · **Homebrew:** \`brew upgrade daniguardiola/tap/zen\`"

# The formula, here and in the tap.
url="https://github.com/DaniGuardiola/zen.dio.la/releases/download/v$version/$tarball"
sed -i '' -e "s|^  url \".*\"|  url \"$url\"|" packaging/zen.rb
tap=$(mktemp -d)
git clone -q git@github.com:DaniGuardiola/homebrew-tap.git "$tap"
sed -i '' -e "s|^  url \".*\"|  url \"$url\"|" -e "s|^  sha256 \".*\"|  sha256 \"$sha\"|" "$tap/Formula/zen.rb"
git -C "$tap" commit -qam "zen $version" && git -C "$tap" push -q
rm -rf "$tap"
git commit -qm "packaging: formula at $version" packaging/zen.rb && git push -q || true

# The page.
bunx wrangler@4 deploy
