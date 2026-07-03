# Multi-stage build for the storage service.
# Build context is the `services/` workspace root (shared libs needed), not this dir.
#   docker build -f storage-service/Dockerfile -t iots-storage .   # run from services/

# ── build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY libs/contracts/package.json ./libs/contracts/
COPY libs/broker/package.json ./libs/broker/
COPY storage-service/package.json ./storage-service/
RUN npm ci

COPY libs ./libs
COPY storage-service ./storage-service
RUN npm run build -w @iots/contracts \
 && npm run build -w @iots/broker \
 && npm run build -w storage-service \
 && npm prune --omit=dev

# ── runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/libs ./libs
COPY --from=build /app/storage-service/package.json ./storage-service/package.json
COPY --from=build /app/storage-service/dist ./storage-service/dist

EXPOSE 3002
CMD ["node", "storage-service/dist/main.js"]
