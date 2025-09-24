FROM node:20-alpine AS deps
WORKDIR /repo
# Copy root manifests for workspaces
COPY package.json package-lock.json turbo.json ./
# Copy only what we need to install and build
COPY apps ./apps
COPY packages ./packages
# Install all workspaces (dev deps are needed to build)
RUN npm ci --workspaces

FROM deps AS build
# Build only ERP and its deps
RUN npx turbo@1.13.2 run build --filter=./apps/mes

FROM node:20-alpine
WORKDIR /repo
ENV NODE_ENV=production
ENV PORT=3000
# Production needs only built app + node_modules
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=build /repo/apps/mes ./apps/mes
EXPOSE 3001
WORKDIR /repo/apps/mes
CMD ["npm","run","start"]