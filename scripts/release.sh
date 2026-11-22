#!/bin/sh
# Builds the companion release tarball for Apple Silicon and prints its sha256.
# Upload dist/zen-<version>-darwin-arm64.tar.gz and dist/SHA256SUMS to a GitHub release v<version>.
set -eu
cd "$(dirname "$0")/.."
version=$(bun -e 'console.log(require("./companion/package.json").version)')
out="dist/zen-$version"
rm -rf "$out" && mkdir -p "$out/speech"
(cd web && bun run build)
(cd companion && bun build --compile --minify --target=bun-darwin-arm64 src/server.ts --outfile "../$out/zen-companion")
cp -R web/dist "$out/web"
cp speech/*.py speech/requirements.txt "$out/speech/"
tar -C "$out" -czf "dist/zen-$version-darwin-arm64.tar.gz" .
(cd dist && shasum -a 256 "zen-$version-darwin-arm64.tar.gz" > SHA256SUMS && cat SHA256SUMS)
