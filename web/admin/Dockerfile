# Katha admin SPA (Vite build) served as static files by nginx. Context: web/admin
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_ADMIN_API_BASE=http://localhost:8800
ENV VITE_ADMIN_API_BASE=${VITE_ADMIN_API_BASE}
RUN npm run build

FROM nginx:1.27-alpine AS run
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
