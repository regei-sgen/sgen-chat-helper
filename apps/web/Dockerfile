# SGEN KB — web dashboard image (multi-stage: build the SPA, serve with nginx).
# Build context = the monorepo ROOT (so the @kb/shared workspace is available to Vite).
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
# tsconfig.base.json is required — apps/web/tsconfig.json `extends` it (vite reads it).
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
# The API URL is inlined at build time. Leave empty to fall back to `${host}:3001`
# (client.ts default); set it for a domain deploy.
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
# Build the bundle only (typecheck is a separate/CI concern).
RUN cd apps/web && npx vite build

FROM nginx:alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
