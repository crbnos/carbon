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
COPY --from=deps /repo/package.json /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml /repo/.npmrc ./
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/packages ./packages
COPY --from=build /repo/apps/${APP} ./apps/${APP}
EXPOSE 3000
WORKDIR /repo/apps/${APP}
CMD ["pnpm","run","start"]
