# syntax=docker/dockerfile:1
# Shared build for React Router SSR apps. Build: docker build --build-arg APP=erp -t carbon/erp .
ARG APP
# SOURCEMAPS=1 keeps node_modules sourcemaps for a debuggable image. Nothing
# reads them at runtime (no --enable-source-maps), so they go by default.
ARG SOURCEMAPS=0

# slim, not node:22 — every native dep ships prebuilt, nothing needs the toolchain.
FROM node:25-slim AS deps
WORKDIR /repo
RUN corepack enable
# Store on a cache mount, so a source-only commit relinks instead of refetching.
ENV npm_config_store_dir=/pnpm/store
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json lingui.config.js ./
# Only the apps this image can build — the rest would bust this layer for nothing.
COPY apps/erp ./apps/erp
COPY apps/mes ./apps/mes
COPY packages ./packages
COPY patches ./patches
# Needed by the postinstall and the //#generate:mcp turbo task.
COPY scripts ./scripts
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile

FROM deps AS build
ARG APP
# CDN base for client assets, baked into the build (vite base is build-time;
# apps/*/vite.config.ts normalizes the trailing slash). Empty keeps assets
# same-origin — the controlled/air-gapped variant is this default, not a flag.
ARG ASSETS_URL
ENV ASSETS_URL=${ASSETS_URL}
ARG NODE_OPTIONS="--max-old-space-size=8024"
ENV NODE_OPTIONS=${NODE_OPTIONS}
RUN --mount=type=cache,id=turbo,target=/repo/.turbo,sharing=locked \
    pnpm run build:${APP}
# Build scratch `runner` must not inherit: .vite is the dep-optimizer cache,
# .ignored_<name> is pnpm's per-importer copy of a side-effects-cached package.
RUN rm -rf apps/${APP}/node_modules/.vite apps/${APP}/node_modules/.ignored_*

# --- Ops image (DB migrations + first-boot seed) --------------------------
# The migrate/seed Jobs need the supabase CLI and tsx/esbuild — exactly what
# `runner` strips for its CVE posture — so they get their own never-exposed
# image, scanned report-only. Kept BEFORE `runner` so `runner` stays the
# default build stage. Pruned in a separate stage because a delete only
# reclaims space across a stage boundary.
FROM deps AS ops-pruned
ARG SOURCEMAPS
RUN find /repo -maxdepth 4 \( -name '.ignored_*' -o -name '.vite' \) \
        -prune -exec rm -rf {} + 2>/dev/null || true ; \
    find /repo/node_modules -type f \( -name '*.d.ts' -o -name '*.d.mts' \
        -o -name '*.d.cts' -o -name '*.md' \) -delete 2>/dev/null || true ; \
    if [ "${SOURCEMAPS}" != "1" ]; then \
        find /repo/node_modules -type f -name '*.map' -delete 2>/dev/null || true ; \
    fi

FROM node:25-slim AS ops
# slim ships no CA certs, and the supabase CLI is a Go binary that verifies TLS
# against the system store — migrations default to sslmode=require.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
# Pre-seeded corepack cache, so `pnpm exec` never dials npmjs from the migrate Job.
COPY --from=ops-pruned /root/.cache/node/corepack /root/.cache/node/corepack
COPY --from=ops-pruned /repo /repo
WORKDIR /repo/packages/database
CMD ["bash"]

# --- Runtime dependency tree ----------------------------------------------
# Runs in its own stage: done in `runner` after the COPY, a delete reclaims
# nothing. Strips build CLIs/binaries (the remaining Trivy CRITICAL/HIGHs; the
# `sst` JS package is kept, only its CLI binary goes; `tar`'s sole consumer is
# the supabase CLI and its fix is unpublished), packages the lockfile hydrates
# but nothing links (a frozen install materializes every importer, docs/
# included — hence next/@mui; react-icons is inlined via ssr.noExternal), and
# sourcemaps/.d.ts/readmes. Verify additions the same way — monaco-editor looks
# strippable but the server bundle imports @monaco-editor/react.
FROM deps AS pruned
ARG SOURCEMAPS
RUN find node_modules/.pnpm -maxdepth 1 -type d \( \
        -name 'sst-linux-*' -o -name 'sst-darwin-*' -o -name 'sst-win32-*' -o \
        -name 'esbuild@*' -o -name '@esbuild+*' -o \
        -name 'supabase@*' -o \
        -name 'tar@*' -o \
        -name 'npm@*' -o \
        -name '@typescript+native-preview-*' -o \
        -name '@biomejs+*' -o \
        -name 'turbo@*' -o -name 'turbo-linux-*' -o -name 'turbo-darwin-*' -o \
        -name '@turbo+*' -o \
        -name '@rolldown+binding-*' -o \
        -name 'vitest@*' -o -name '@vitest+*' -o \
        -name '@react-email+preview-server@*' -o \
        -name 'next@*' -o -name '@next+*' -o \
        -name '@mui+*' -o \
        -name 'react-icons@*' \
    \) -prune -exec rm -rf {} + ; \
    find node_modules -type d -name '@esbuild' -prune -exec rm -rf {} + 2>/dev/null || true ; \
    find packages -type d \( -name '.ignored_*' -o -name '.vite' \) -prune -exec rm -rf {} + 2>/dev/null || true ; \
    find node_modules -type f \( -name '*.d.ts' -o -name '*.d.mts' \
        -o -name '*.d.cts' -o -name '*.md' \) -delete 2>/dev/null || true ; \
    if [ "${SOURCEMAPS}" != "1" ]; then \
        find node_modules -type f -name '*.map' -delete 2>/dev/null || true ; \
    fi

FROM node:25-slim AS runner
ARG APP
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
ENV NODE_ENV=production
ENV PORT=3000
# Date derivation assumes UTC until company/location timezones are threaded everywhere
ENV TZ=UTC
COPY --from=deps /repo/package.json /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml /repo/.npmrc ./
COPY --from=pruned /repo/node_modules ./node_modules
COPY --from=pruned /repo/packages ./packages
COPY --from=build /repo/apps/${APP} ./apps/${APP}
# The base image's npm is unused (corepack/pnpm only) and vendors the last Trivy CRITICALs.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
EXPOSE 3000
WORKDIR /repo/apps/${APP}
CMD ["pnpm","run","start"]
