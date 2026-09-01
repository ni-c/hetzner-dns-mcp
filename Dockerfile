# Build stage
#
# node:24-alpine is the ACTIVE LTS line, not the newest tag — roughly half of all
# Node majors never become LTS, so "newest" and "supported" are different things.
# What keeps this honest is a comparison, not a version number written down here:
# `node:lts-alpine` and `node:24-alpine` MUST resolve to the same digest. The day
# 24 leaves LTS they diverge, and that is visible; a hardcoded version in a comment
# is not. Verified 2026-09-01: both resolve to the digest below, Node 24.20.0.
# Refresh the digest and re-run that comparison together — a stale tag is
# invisible if only the digest is re-resolved.
FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

# Runtime
FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf
WORKDIR /app
ENV NODE_ENV=production

# CVE-2026-14456: the pinned base image carries OpenSSL 3.5.7-r0, and Alpine's
# fixed 3.5.8-r0 has not been rebuilt into node:24-alpine yet. Upgrading these
# two packages by name rather than running a blanket `apk upgrade` keeps the
# rest of the image exactly as the digest pins it. Drop this once the base
# image ships the fix.
RUN apk add --no-cache --upgrade libcrypto3 libssl3

# npm is never invoked at runtime, but its vendored dependencies keep showing up
# in image scans. Removing it drops that surface entirely.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# The server reports its version from package.json at runtime (src/server.ts).
COPY package.json ./

# Ownership proof for the MCP Registry: must match server.json's name.
LABEL io.modelcontextprotocol.server.name="io.github.ni-c/hetzner-dns-mcp"

# Drop root: the node image ships an unprivileged `node` user (uid 1000).
USER node

# stdio transport only — no port, no healthcheck. The server starts without
# HETZNER_API_TOKEN (tools are listable); calls fail with a helpful message.
ENTRYPOINT ["node", "dist/index.js"]
