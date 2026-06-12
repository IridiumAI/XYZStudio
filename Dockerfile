# Server / worker image
FROM node:22-bookworm-slim AS build
RUN corepack enable pnpm
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @xyzstudio/shared --filter @xyzstudio/server
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @xyzstudio/shared build && pnpm --filter @xyzstudio/server build

FROM node:22-bookworm-slim
# ffmpeg for assembly; CJK fonts for Mandarin on-screen text (Remotion, Phase 2)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]
