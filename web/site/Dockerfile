# Katha marketing/watch site (Next.js). Build context: web/site
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# NEXT_PUBLIC_* are inlined at build time. Unset = same origin (the edge serves
# /v1 and /media on the site host); NEXT_PUBLIC_SITE_ORIGIN makes og:image
# URLs absolute.
ARG NEXT_PUBLIC_API_BASE=
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}
ARG NEXT_PUBLIC_SITE_ORIGIN=
ENV NEXT_PUBLIC_SITE_ORIGIN=${NEXT_PUBLIC_SITE_ORIGIN}
RUN npm run build

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
RUN useradd -m -u 10002 web && chown -R web /app
USER web
EXPOSE 3000
CMD ["npm", "run", "start", "--", "-p", "3000", "-H", "0.0.0.0"]
