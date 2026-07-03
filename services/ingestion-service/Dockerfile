# Multi-stage build for the ingestion service.
# IMPORTANT: build context is the `services/` workspace root (so the shared libs
# are available), not this directory. See docker/docker-compose.yml.
#
#   docker build -f ingestion-service/Dockerfile -t iots-ingestion .   # run from services/

# ── build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Manifests first for layer caching.
COPY package.json package-lock.json tsconfig.base.json ./
COPY libs/contracts/package.json ./libs/contracts/
COPY libs/broker/package.json ./libs/broker/
COPY ingestion-service/package.json ./ingestion-service/
RUN npm ci

# Sources + build (contracts → broker → ingestion).
COPY libs ./libs
COPY ingestion-service ./ingestion-service
RUN npm run build -w @iots/contracts \
 && npm run build -w @iots/broker \
 && npm run build -w ingestion-service \
 && npm prune --omit=dev

# ── runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
# Shared libs (workspace symlinks in node_modules resolve into here).
COPY --from=build /app/libs ./libs
COPY --from=build /app/ingestion-service/package.json ./ingestion-service/package.json
COPY --from=build /app/ingestion-service/dist ./ingestion-service/dist

EXPOSE 3001
CMD ["node", "ingestion-service/dist/main.js"]
