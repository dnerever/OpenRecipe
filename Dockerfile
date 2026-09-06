# syntax=docker/dockerfile:1

# A plain container, deliberately. It is the portability contract: any host that
# runs Docker runs this, so moving off one provider is a config change rather
# than a rewrite. Nothing in here knows which host it is on.

# ---------- build ----------
FROM node:24-alpine AS build
WORKDIR /app

# Manifests first, so a dependency-free code change reuses the install layer.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/api apps/api
COPY apps/web apps/web

# core -> dist, api -> dist, web -> static bundle
RUN npm run build -w @openrecipe/core \
 && npm run build -w @openrecipe/api \
 && npm run build -w @openrecipe/web

# tsc emits .js but not the .sql files beside them.
RUN cp -r apps/api/src/db/migrations apps/api/dist/db/migrations

# ---------- runtime ----------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only.
#
# `--omit=optional` is doing real work here, not belt-and-braces: better-auth
# declares drizzle-kit as an *optional peer*, and npm installs optional peers
# regardless of --omit=dev. That drags in drizzle-kit, esbuild and tsx — 42 MB
# of migration tooling this container never runs, and on a free tier that is
# image pull time on every cold start.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --omit=optional \
 && npm cache clean --force

COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist

# Hono serves the SPA from this directory, same origin as the API.
ENV SERVE_STATIC_DIR=/app/apps/web/dist
ENV PORT=8787
EXPOSE 8787

# Never run as root.
USER node

# Migrations run before the server binds, so a release can never serve traffic
# against a schema it does not expect.
CMD ["sh", "-c", "node apps/api/dist/db/migrate.js && node apps/api/dist/index.js"]
