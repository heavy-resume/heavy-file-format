#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/build-hosted-viewer-image.sh PATH_TO_FILE.hvy IMAGE[:TAG]

Example:
  scripts/build-hosted-viewer-image.sh examples/example.hvy my-hvy-viewer:latest

The built image serves the extracted HVY viewer on port 8080.
Run it with:
  docker run --rm -p 8080:8080 IMAGE[:TAG]
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -ne 2 ]]; then
  usage >&2
  exit 1
fi

hvy_file="$1"
image_tag="$2"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$hvy_file" ]]; then
  echo "HVY file not found: $hvy_file" >&2
  exit 1
fi

case "$image_tag" in
  *:*) ;;
  *) image_tag="${image_tag}:latest" ;;
esac

build_root="$(mktemp -d "${TMPDIR:-/tmp}/hvy-viewer-image.XXXXXX")"
cleanup() {
  rm -rf "$build_root"
}
trap cleanup EXIT

site_dir="$build_root/site"
public_dir="$build_root/public"
mkdir -p "$site_dir" "$public_dir"

cd "$repo_root"
npm run build:embed
node scripts/extract-hvy-assets.mjs "$hvy_file" --out "$site_dir"

cp hosted-viewer/index.html hosted-viewer/viewer.css hosted-viewer/viewer.js "$public_dir/"
cp -R dist-embed/. "$public_dir/"
embed_css="$(find dist-embed/assets -maxdepth 1 -name '*.css' -print -quit)"
if [[ -z "$embed_css" ]]; then
  echo "Could not find built HVY embed CSS in dist-embed/assets" >&2
  exit 1
fi
cp "$embed_css" "$public_dir/hvy-embed.css"
cp hosted-viewer/server.mjs "$build_root/server.mjs"
cp hosted-viewer/Dockerfile.baked "$build_root/Dockerfile"

docker build -t "$image_tag" "$build_root"

cat <<EOF

Built $image_tag

Run it with:
  docker run --rm -p 8080:8080 $image_tag

Then open:
  http://localhost:8080
EOF
