# syntax=docker/dockerfile:1
# Shared build for React Router SSR apps. Build: docker build --build-arg APP=erp -t carbon/erp .
ARG APP

FROM node:22 AS deps
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json lingui.config.js ./
COPY apps ./apps
COPY packages ./packages
COPY patches ./patches
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG APP
ARG NODE_OPTIONS="--max-old-space-size=8024"
ENV NODE_OPTIONS=${NODE_OPTIONS}
RUN pnpm run build:${APP}

FROM node:22-slim AS runner
ARG APP
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
ENV NODE_ENV=production
ENV PORT=3000
# Date derivation assumes UTC until company/location timezones are threaded everywhere
ENV TZ=UTC
COPY --from=deps /repo/package.json /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml /repo/.npmrc ./
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/packages ./packages
COPY --from=build /repo/apps/${APP} ./apps/${APP}
# Strip build-time CLI tooling that the multi-stage copy drags into the runtime
# node_modules but the running server (react-router-serve) never executes: the
# prebuilt Go binaries inside sst's CLI, esbuild, the supabase CLI, and the
# typescript-go preview. They trail the current Go security release and are the
# only Trivy CRITICAL/HIGH left once the JS deps are patched, so removing them
# clears the findings at the source and shrinks the image. The `sst` JS package
# (import { Resource }) is kept — only its platform CLI binary is dropped.
# `tar` is stripped for the same reason: its sole consumer is the supabase CLI
# (removed just above), no app runtime imports it, and its GHSA-r292-9mhp-454m
# DoS fix (tar@7.5.21) is not published to npm yet — so it cannot be pinned away
# and is instead removed from the image where the scanner sees it.
RUN find node_modules/.pnpm -maxdepth 1 -type d \( \
        -name 'sst-linux-*' -o -name 'sst-darwin-*' -o -name 'sst-win32-*' -o \
        -name 'esbuild@*' -o -name '@esbuild+*' -o \
        -name 'supabase@*' -o \
        -name 'tar@*' -o \
        -name '@typescript+native-preview-*' \
    \) -prune -exec rm -rf {} + ; \
    find node_modules -type d -name '@esbuild' -prune -exec rm -rf {} + 2>/dev/null || true
EXPOSE 3000
WORKDIR /repo/apps/${APP}
CMD ["pnpm","run","start"]
