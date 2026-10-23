# syntax=docker/dockerfile:1.7
#
# One file, three images:
#   runtime  the API and the worker (same image, different command)
#   tools    one-off jobs on the server: database migrations and the first-admin / question-bank seed
#
# The TypeScript build runs on the machine doing the build; only the production dependencies are
# installed for the target CPU. That keeps a multi-architecture build (amd64 + arm64) fast.

ARG NODE_VERSION=24

# ---- Build (always on the builder's own CPU: the output is plain JavaScript) -------------------
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
# prisma generate only reads the schema; the URL just has to look like one.
RUN DATABASE_URL=mysql://build:build@localhost:3306/build npx prisma generate
RUN npm run build

# ---- Production dependencies (on the target CPU, so native modules such as argon2 match) -------
FROM node:${NODE_VERSION}-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund

# ---- Runtime: the API and the worker -----------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 4000
# The worker runs the same image with: node dist/apps/worker/main.js
CMD ["node", "dist/apps/api/main.js"]

# ---- Tools: migrations and seeding -------------------------------------------------------------
# prisma (the migration CLI) is already in the production install as @prisma/client's peer, at the exact version
# the lock file pins. tsx runs the seed script; it is a dev dependency, so it is installed on its own.
FROM prod-deps AS tools
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    TSX="$(node -p "require('./package-lock.json').packages['node_modules/tsx'].version")" && \
    npm install --global --no-audit --no-fund "tsx@${TSX}" && \
    test -x node_modules/.bin/prisma && \
    npx prisma --version
COPY prisma7.config.ts tsconfig.json ./
COPY libs/model/prisma ./libs/model/prisma
COPY --from=build /app/libs/model/src/generated ./libs/model/src/generated
COPY interviewcall.problems.json ./
CMD ["npx", "prisma", "migrate", "deploy"]
