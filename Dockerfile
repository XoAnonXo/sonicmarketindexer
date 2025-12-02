# =============================================================================
# Anymarket Ponder Indexer Dockerfile
# =============================================================================
# Multi-stage build for optimized production image

# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Stage 2: Build/Generate types
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependencies from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Ponder types from schema
RUN npm run codegen

# Stage 3: Production image
FROM node:20-alpine AS runner
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=42069

# Copy necessary files
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.ponder ./.ponder
COPY --from=builder /app/ponder.config.ts ./
COPY --from=builder /app/ponder.schema.ts ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/abis ./abis

# Expose GraphQL API port
EXPOSE 42069

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:42069/health || exit 1

# Start the indexer
CMD ["npm", "run", "start"]

