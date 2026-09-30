# Production Dockerfile for Kanpur Tactical GIS & Safety Navigator
FROM node:20-alpine

# Set non-root environment and production flags
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

# Install security patches & wget for healthcheck
RUN apk --no-cache add wget ca-certificates

# Copy package descriptors first to maximize layer cache
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production --ignore-scripts && npm cache clean --force

# Copy application source files with ownership
COPY --chown=node:node . .

# Run strictly as unprivileged node user
USER node

# Expose internal service port
EXPOSE 3000

# Docker healthcheck targeting /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

# Start production server
CMD ["node", "server.js"]
