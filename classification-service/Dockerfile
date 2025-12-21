# Classification Service Dockerfile
# Uses TensorFlow.js with MobileNet for rodent detection

FROM node:20-slim

# Install dependencies for TensorFlow.js native bindings
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    libc6-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package.json only (not package-lock.json to ensure native bindings compile for Linux)
COPY package.json ./
COPY tsconfig.json ./

# Install dependencies - will compile native bindings for this platform
RUN npm install --build-from-source

# Copy source
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 3100

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3100/health || exit 1

# Start the service
CMD ["npm", "start"]
