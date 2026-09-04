# Katha admin SPA (Vite build) served as static files by nginx. Context: web/admin
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Same-origin by default: the edge proxies /admin/v1 on the admin host, so the
# OIDC session cookie always travels. Override only for a split deployment.
ARG VITE_ADMIN_API_BASE=
ENV VITE_ADMIN_API_BASE=${VITE_ADMIN_API_BASE}
# Where covers load from (the public app origin in QA/prod).
ARG VITE_MEDIA_BASE=
ENV VITE_MEDIA_BASE=${VITE_MEDIA_BASE}
RUN npm run build

FROM nginx:1.27-alpine AS run
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
