# syntax=docker/dockerfile:1.7
# Build context MUST be the repository root so ./sdk and ./mcp are visible.
#   docker build -f mcp/Dockerfile -t paysats-mcp .
#
# Railway: set the service "Root Directory" to the repo root and "Dockerfile Path"
# to mcp/Dockerfile so this works unmodified.

ARG NODE_VERSION=20

FROM node:${NODE_VERSION}-alpine AS sdk-build
WORKDIR /repo/sdk
COPY sdk/package.json sdk/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY sdk/ ./
RUN npm run build

FROM node:${NODE_VERSION}-alpine AS mcp-build
WORKDIR /repo
COPY --from=sdk-build /repo/sdk /repo/sdk
COPY mcp/package.json /repo/mcp/package.json
WORKDIR /repo/mcp
RUN npm install --no-audit --no-fund
COPY mcp/tsconfig.json ./tsconfig.json
COPY mcp/src ./src
RUN npm run build

FROM node:${NODE_VERSION}-alpine AS runner
ENV NODE_ENV=production
ENV PAYSATS_MCP_TRANSPORT=http
WORKDIR /repo/mcp
COPY --from=sdk-build /repo/sdk /repo/sdk
COPY --from=mcp-build /repo/mcp/dist ./dist
COPY --from=mcp-build /repo/mcp/node_modules ./node_modules
COPY mcp/package.json ./package.json
# Railway provides PORT; local defaults inside env.ts
EXPOSE 3333
CMD ["node", "dist/index.js"]
