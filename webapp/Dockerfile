# webapp — multi-stage build. Vite bakes VITE_API_URL at build time; override with
# --build-arg VITE_API_URL=... when building a non-localhost artifact.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_API_URL=http://localhost:3003
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ─── Runtime: nginx serves the static build. ───────────────────────────────
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
