# OpenLango — pnpm workspace + Next.js standalone
# 注意：本 Dockerfile 编写时作者本机无 docker，未经实机构建验证；按标准模板编写，欢迎 PR 修正。
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/providers/package.json packages/providers/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/packages/providers/node_modules ./packages/providers/node_modules
COPY . .
RUN pnpm --filter @openlango/web build

FROM base AS runner
ENV NODE_ENV=production
ENV OPENLANGO_ROOT=/app
WORKDIR /app
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
RUN mkdir -p /app/data /app/config
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
