# SWAMP — production image for self-hosting.
#
# Three stages so the thing that ships carries no build tooling, no source, and
# no dev dependencies: deps installs, builder compiles, runner runs.
#
# Requires `output: "standalone"` in next.config.mjs (already set) — that is what
# emits a server.js with only the modules actually imported, turning a ~1GB
# node_modules into a ~150MB image.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* are INLINED AT BUILD TIME, not read at runtime. Passing them only
# via env_file means the browser bundle ships with them undefined and the app
# boots to a blank screen — the single most common self-host failure.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_ANALYTICS
ARG GIT_SHA
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_ANALYTICS=$NEXT_PUBLIC_ANALYTICS \
    GIT_SHA=$GIT_SHA \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1

# Next's image optimiser wants sharp; without it every /_next/image is unoptimised.
RUN apk add --no-cache curl && npm i -g sharp@0.33.5 2>/dev/null || true

# Run as a non-root user. A container that runs as root is one container escape
# away from being the host.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# GIT_SHA again: the builder stage's ENV does not survive into this stage, and
# /api/health reads it at RUNTIME to report which deploy answered.
ARG GIT_SHA
ENV GIT_SHA=$GIT_SHA

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

# Compose restarts an unhealthy container; /api/health already checks the DB.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
