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
#
# An OCCT base missing from REGISTRY is taken from Carbon's public one when
# it has the same tag, so a fork or a new registry does not spend 30 minutes
# compiling OCCT. Only sources no registry has built are compiled.
#
# Every image is also tagged :src-<hash> of what it is built from: its
# paths' contents (from git's own blob hashes, so ~20ms for erp's 8,000
# files), its Dockerfile, target and build args. A commit whose image
# inputs some other commit already built, on any branch, re-tags that image
# instead of building it — a merge of main into a release branch builds
# nothing main has not.
set -euo pipefail

CARBON_OCCT=public.ecr.aws/b8l5b8t9/carbon/occt

name=${1:?usage: build-images.sh <image>}
image="$REGISTRY/carbon/$name"
target=""
args=""

# erp and mes share the root Dockerfile's deps stage.
node=(Dockerfile .dockerignore package.json pnpm-lock.yaml pnpm-workspace.yaml
  .npmrc turbo.json lingui.config.js apps/erp apps/mes packages patches scripts)

case "$name" in
  erp | mes)
    file=Dockerfile
    args="APP=$name"$'\n'"NODE_OPTIONS=--max-old-space-size=4096"
    paths=("${node[@]}")
    ;;
  bootstrap)
    # Installs only @carbon/database, so only that package rebuilds it.
    file=Dockerfile
    target=bootstrap
    paths=(Dockerfile .dockerignore package.json pnpm-lock.yaml pnpm-workspace.yaml
      .npmrc patches packages/config packages/database)
    ;;
  edge-functions)
    file=packages/database/supabase/edge-runtime/Dockerfile
    paths=(packages/database/supabase/edge-runtime packages/database/supabase/functions)
    ;;
  assembler)
    file=apps/assembler/Dockerfile
    # Tagged by what it is built from, so an unchanged base is never rebuilt
    # and a changed one never reused.
    occt_tree=$(git ls-tree -r "$SHA" -- apps/assembler/occt.Dockerfile apps/assembler/occt-patches)
    [[ -n $occt_tree ]] || { echo "no OCCT sources at $SHA" >&2; exit 1; }
    occt_src=$(git hash-object --stdin <<<"$occt_tree")
    occt="$REGISTRY/carbon/occt:${occt_src:0:12}"
    paths=(.dockerignore apps/assembler crates Cargo.toml Cargo.lock)
    ;;
  *)
    echo "unknown image: $name" >&2
    exit 1
    ;;
esac

# What this image is built from, before OCCT_IMAGE joins the args below:
# that names the same base by where it is pulled from, which is not an input.
src="src-$({
  printf '%s\n' "$file" "$target" "$args"
  git ls-tree -r "$SHA" -- "${paths[@]}"
} | git hash-object --stdin | cut -c1-12)"

out() { echo "$1=$2" >>"$GITHUB_OUTPUT"; }
exists() { docker buildx imagetools inspect "$1" >/dev/null 2>&1; }
has_tag() { exists "$image:$1"; }

# ECR is the one registry that will not create a repository on first push.
ensure_repo() {
  [[ $REGISTRY =~ \.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com ]] || return 0
  local repo=${1#*/}
  aws ecr describe-repositories --repository-names "$repo" >/dev/null 2>&1 ||
    aws ecr create-repository --repository-name "$repo" \
      --image-scanning-configuration scanOnPush=true >/dev/null
}

ensure_repo "$image"

if [[ -n ${occt:-} ]] && ! exists "$occt" && exists "$CARBON_OCCT:${occt##*:}"; then
  echo "using Carbon's public OCCT base: $CARBON_OCCT:${occt##*:}"
  occt="$CARBON_OCCT:${occt##*:}"
fi
[[ -n ${occt:-} ]] && args="OCCT_IMAGE=$occt"

out image "$image"
out src "$src"
out file "$file"
out target "$target"
printf 'args<<EOF\n%s\nEOF\n' "$args" >>"$GITHUB_OUTPUT"

if has_tag "$SHA"; then
  if has_tag "$src"; then
    echo "$image:$SHA exists"
    out action skip
  else
    # Built before images carried their sources: tag it, so the next
    # commit with these files finds it.
    echo "$image:$SHA exists without :$src: tagging it"
    out action retag
    out from "$SHA"
  fi
  exit 0
fi

if has_tag "$src"; then
  echo "built from these files before: re-tagging $image:$src"
  out action retag
  out from "$src"
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
  # Images from before :src- tags: the previous commit's, when its files
  # are these.
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
