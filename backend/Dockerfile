# Production image: the compiled API and its runtime dependencies, nothing
# else. Development uses dockerfile.dev (compose) instead.

FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# uploaded files (a volume in compose.prod.yaml), writable by the app
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 5001
# Pending migrations first (as the schema owner, MIGRATION_DATABASE_URL), then
# the API (as the limited role, DATABASE_URL). A failed migration stops here
# instead of starting against an outdated schema.
CMD ["sh", "-c", "node dist/database/migrate.js && exec node dist/main.js"]
