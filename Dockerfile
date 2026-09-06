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
#
# The prune is part of *this* RUN on purpose. Layers are additive, so deleting
# a file in a later step leaves it in the image and only adds a whiteout entry
# — the bytes come back on every pull. Removed here, they are never committed.
#
# Type declarations and source maps are half the installed bytes (24.6 MB of
# 49.5 MB) and 5,500 of its 10,500 files. Node resolves neither at runtime:
# .d.ts is a compile-time artifact, and maps are inert unless something passes
# --enable-source-maps, which nothing here does. Licences stay.
RUN npm ci --omit=dev --omit=optional \
 && find node_modules -type f \
      \( -name '*.d.ts' -o -name '*.d.cts' -o -name '*.d.mts' -o -name '*.map' \) \
      -delete \
 && npm cache clean --force

# sharp ships its native libvips as *optional* platform packages, and the
# --omit=optional above would drop them — leaving a `sharp` that throws on
# first require. Taking them from the build stage rather than relaxing the flag
# keeps drizzle-kit and esbuild out while keeping the image processing in, and
# guarantees the binaries match the ones the build resolved.
COPY --from=build /app/node_modules/@img node_modules/@img

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
