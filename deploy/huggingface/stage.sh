#!/bin/sh
# Assembles a Hugging Face Docker Space for the VoxShield API in a separate, empty folder. Nothing in the repository is
# changed. Upload the folder afterwards, for example:
#   deploy/huggingface/stage.sh /tmp/voxshield-space
#   hf upload <user>/<space> /tmp/voxshield-space . --repo-type space
set -eu

out="${1:?usage: deploy/huggingface/stage.sh <empty output folder>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"

if [ -e "$out" ] && [ -n "$(ls -A "$out")" ]; then
  echo "$out is not empty; give a new or empty folder." >&2
  exit 1
fi
mkdir -p "$out/scripts"

cp "$root/deploy/huggingface/README.md" "$out/README.md" # the Space card: sdk docker, app_port 8000
cp "$root/backend/Dockerfile" "$root/backend/.dockerignore" "$root/backend/requirements.txt" "$root/backend/requirements.lock.txt" "$out/"
cp "$root/backend/scripts/download_models.py" "$out/scripts/"
cp -R "$root/backend/app" "$out/app"
find "$out" -name __pycache__ -type d -prune -exec rm -rf {} +

echo "Staged the Space in $out:"
find "$out" -maxdepth 2 | sort
