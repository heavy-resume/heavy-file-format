#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/build-hosted-viewer-image.sh [--no-cache] [--platform PLATFORM] [--push] PATH_TO_FILE.hvy IMAGE[:TAG]

Example:
  scripts/build-hosted-viewer-image.sh examples/example.hvy my-hvy-viewer:latest
  scripts/build-hosted-viewer-image.sh --no-cache examples/example.hvy my-hvy-viewer:latest
  scripts/build-hosted-viewer-image.sh --push examples/example.hvy REGISTRY_HOST/PROJECT/REPOSITORY/my-hvy-viewer:latest

The built image serves the extracted HVY viewer on port 8080.
Run it with:
  docker run --rm -p 8080:8080 IMAGE[:TAG]
USAGE
}

docker_no_cache=false
docker_push=false
docker_platform="${HVY_DOCKER_PLATFORM:-linux/amd64}"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    --no-cache)
      docker_no_cache=true
      shift
      ;;
    --push)
      docker_push=true
      shift
      ;;
    --platform)
      if [[ -z "${2:-}" ]]; then
        echo "--platform requires a value, for example linux/amd64" >&2
        exit 1
      fi
      docker_platform="$2"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      break
      ;;
  esac
done

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
node hosted-viewer/prepare-hosted-viewer-public.mjs "$public_dir" dist-embed
cp hosted-viewer/server.mjs "$build_root/server.mjs"
cp hosted-viewer/Dockerfile.baked "$build_root/Dockerfile"

docker_args=(--platform "$docker_platform")
if [[ "$docker_no_cache" == "true" ]]; then
  docker_args+=(--no-cache)
fi
if [[ "$docker_push" == "true" ]]; then
  docker buildx build "${docker_args[@]}" --push -t "$image_tag" "$build_root"
else
  docker build "${docker_args[@]}" -t "$image_tag" "$build_root"
fi

cat <<EOF

Built $image_tag
Platform: $docker_platform

Run it with:
  docker run --rm -p 8080:8080 $image_tag

Then open:
  http://localhost:8080
EOF
