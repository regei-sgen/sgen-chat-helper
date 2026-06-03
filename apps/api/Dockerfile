# SGEN KB — API + worker image.
# Build context = the monorepo ROOT (so the @kb/shared workspace is available).
# Runs via `tsx` (not a tsc build): apps/api uses moduleResolution "Bundler" and @kb/shared
# resolves to raw .ts, so tsx — exactly what dev uses — is the reliable runtime.
FROM node:20-bookworm-slim
WORKDIR /app
# NOTE: do NOT set NODE_ENV=production before `npm ci` — tsx + prisma are devDependencies that this
# image needs at runtime, and production mode would omit them. We set it at the end instead.

# Prisma's query engine needs OpenSSL on slim Debian.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# 1) Manifests first for layer caching, then install the whole workspace (tsx + prisma are
#    dev-deps but required at runtime here, so we keep dev deps).
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

# 2) Source for the API + the shared workspace (web source isn't needed by the API).
#    tsconfig.base.json is required — both apps/api and packages/shared tsconfigs `extends` it,
#    and tsx reads it at runtime.
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# 3) Generate the Prisma client for this (Linux) platform.
RUN npx prisma generate --schema apps/api/prisma/schema.prisma

ENV NODE_ENV=production
EXPOSE 3001
# Default command = API server. The worker service overrides this with worker.ts.
CMD ["npx", "tsx", "apps/api/src/server.ts"]
