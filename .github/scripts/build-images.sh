#!/usr/bin/env bash
# Plans one image for build-images.yml: build it, re-tag the previous
# commit's image (its files did not change), or skip (already tagged).
# Writes action, image, from, file, target and args to $GITHUB_OUTPUT.
#
#   REGISTRY=… SHA=… [BEFORE=…] build-images.sh <image>
set -euo pipefail

name=${1:?usage: build-images.sh <image>}
repo="carbon/$name"
target=""
args=""

# erp, mes and ops share the root Dockerfile's deps stage.
node=(Dockerfile .dockerignore package.json pnpm-lock.yaml pnpm-workspace.yaml
  .npmrc turbo.json lingui.config.js apps/erp apps/mes packages patches scripts)

case "$name" in
  erp | mes)
    file=Dockerfile
    args="APP=$name"$'\n'"NODE_OPTIONS=--max-old-space-size=4096"
    paths=("${node[@]}")
    ;;
  ops)
    file=Dockerfile
    target=ops
    paths=("${node[@]}")
    ;;
  edge-functions)
    file=docker/edge-functions/Dockerfile
    paths=(docker/edge-functions packages/database/supabase/functions)
    ;;
  assembler)
    file=apps/assembler/Dockerfile
    args="OCCT_IMAGE=$REGISTRY/carbon/occt:8.0.0-p1"
    paths=(.dockerignore apps/assembler crates Cargo.toml Cargo.lock)
    ;;
  *)
    echo "unknown image: $name" >&2
    exit 1
    ;;
esac

out() { echo "$1=$2" >>"$GITHUB_OUTPUT"; }
has_tag() { aws ecr describe-images --repository-name "$repo" --image-ids imageTag="$1" >/dev/null 2>&1; }

aws ecr describe-repositories --repository-names "$repo" >/dev/null 2>&1 ||
  aws ecr create-repository --repository-name "$repo" \
    --image-scanning-configuration scanOnPush=true >/dev/null

out image "$REGISTRY/$repo"
out file "$file"
out target "$target"
printf 'args<<EOF\n%s\nEOF\n' "$args" >>"$GITHUB_OUTPUT"

if has_tag "$SHA"; then
  echo "$repo:$SHA exists"
  out action skip
  exit 0
fi

# A manual run has no BEFORE; a push of several commits puts it outside
# the shallow checkout.
before=${BEFORE:-}
if [[ -z $before || $before =~ ^0+$ ]]; then
  before=$(git rev-parse "$SHA^" 2>/dev/null || true)
fi
if [[ -n $before ]]; then
  git fetch --quiet --depth=1 origin "$before" 2>/dev/null || true
fi

if [[ -n $before ]] && git cat-file -e "$before^{commit}" 2>/dev/null &&
  git diff --quiet "$before" "$SHA" -- "${paths[@]}" && has_tag "$before"; then
  echo "unchanged since $before: re-tagging"
  out action retag
  out from "$before"
else
  echo "building"
  out action build
fi
