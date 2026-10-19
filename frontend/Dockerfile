# Production image: Next's standalone server. Development uses dockerfile.dev.

FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# NEXT_PUBLIC_* are baked in at build time: pass them as build args
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_FEEDBACK_EMAIL
# the site's own address: link previews need absolute URLs
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_FEEDBACK_EMAIL=$NEXT_PUBLIC_FEEDBACK_EMAIL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "Build arg NEXT_PUBLIC_API_URL is required" && exit 1)
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
# owned by the user it runs as: Next writes its image cache under .next/cache
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
RUN mkdir -p .next/cache && chown node:node .next/cache
USER node
EXPOSE 3000
CMD ["node", "server.js"]
