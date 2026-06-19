FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .

# Final stage
FROM node:20-slim

WORKDIR /app

COPY --from=builder /app /app

ENV PORT=3007
ENV DB_PATH=/app/data/database.sqlite

EXPOSE 3007

VOLUME ["/app/data"]

# Liveness probe — hits the unauthenticated /healthz endpoint via Node (no curl needed).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3007)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["npm", "start"]
