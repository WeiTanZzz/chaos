# Build from the workspace root: docker build -f apps/api/Dockerfile -t mcp .
FROM oven/bun:1.4-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps ./apps
RUN bun install --frozen-lockfile --production
USER bun
EXPOSE 4400
CMD ["bun", "run", "apps/api/src/index.ts"]
