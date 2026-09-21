#!/usr/bin/env bash
# Plans one image for build-images.yml: build it, re-tag the previous
# commit's image (its files did not change), or skip (already tagged).
# Writes action, image, from, file, target and args to $GITHUB_OUTPUT, and
# for an assembler build, occt and occt_build: the OCCT base it links, and
# whether that base has to be built first.
#
#   REGISTRY=… SHA=… [BEFORE=…] build-images.sh <image>
#
# REGISTRY is any OCI registry the runner is logged into, with an optional
# namespace: ghcr.io/acme, docker.io/acme, 123456789012.dkr.ecr.….
set -euo pipefail

name=${1:?usage: build-images.sh <image>}
[[ ${IMAGE_KEEP:-100} =~ ^[1-9][0-9]*$ ]] || { echo "IMAGE_KEEP must be a positive number" >&2; exit 1; }
image="$REGISTRY/carbon/$name"
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
    # Tagged by what it is built from, so an unchanged base is never rebuilt
    # and a changed one never reused.
    occt_tree=$(git ls-tree -r "$SHA" -- apps/assembler/occt.Dockerfile apps/assembler/occt-patches)
    [[ -n $occt_tree ]] || { echo "no OCCT sources at $SHA" >&2; exit 1; }
    occt_src=$(git hash-object --stdin <<<"$occt_tree")
    occt="$REGISTRY/carbon/occt:${occt_src:0:12}"
    args="OCCT_IMAGE=$occt"
    paths=(.dockerignore apps/assembler crates Cargo.toml Cargo.lock)
    ;;
  *)
    echo "unknown image: $name" >&2
    exit 1
    ;;
esac

out() { echo "$1=$2" >>"$GITHUB_OUTPUT"; }
exists() { docker buildx imagetools inspect "$1" >/dev/null 2>&1; }
has_tag() { exists "$image:$1"; }

# ECR is the one registry that will not create a repository on first push.
# Each repository also gets a cleanup policy, unless it already has one:
# latest and buildcache are kept, untagged images (old caches) expire after
# a week, and the newest IMAGE_KEEP images (default 100) are kept. ECR counts
# images, not tags, so an image re-tagged across many commits is one image.
ensure_repo() {
  [[ $REGISTRY =~ \.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com ]] || return 0
  local repo=${1#*/}
  aws ecr describe-repositories --repository-names "$repo" >/dev/null 2>&1 ||
    aws ecr create-repository --repository-name "$repo" \
      --image-scanning-configuration scanOnPush=true >/dev/null
  aws ecr get-lifecycle-policy --repository-name "$repo" >/dev/null 2>&1 ||
    aws ecr put-lifecycle-policy --repository-name "$repo" \
      --lifecycle-policy-text "$(lifecycle_policy)" >/dev/null
}

lifecycle_policy() {
  cat <<EOF
{"rules": [
  {"rulePriority": 1, "description": "keep latest and buildcache",
   "selection": {"tagStatus": "tagged", "tagPatternList": ["latest", "buildcache"],
                 "countType": "imageCountMoreThan", "countNumber": 9999},
   "action": {"type": "expire"}},
  {"rulePriority": 2, "description": "expire untagged after 7 days",
   "selection": {"tagStatus": "untagged", "countType": "sinceImagePushed",
                 "countUnit": "days", "countNumber": 7},
   "action": {"type": "expire"}},
  {"rulePriority": 3, "description": "keep the newest ${IMAGE_KEEP:-100} images",
   "selection": {"tagStatus": "any", "countType": "imageCountMoreThan",
                 "countNumber": ${IMAGE_KEEP:-100}},
   "action": {"type": "expire"}}
]}
EOF
}

ensure_repo "$image"

out image "$image"
out file "$file"
out target "$target"
printf 'args<<EOF\n%s\nEOF\n' "$args" >>"$GITHUB_OUTPUT"

if has_tag "$SHA"; then
  echo "$image:$SHA exists"
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
  if [[ -n ${occt:-} ]]; then
    out occt "$occt"
    if exists "$occt"; then
      out occt_build false
    else
      echo "no $occt: building it first"
      ensure_repo "${occt%:*}"
      out occt_build true
    fi
  fi
fi
