# Multi-stage build for Render deployment
# Stage 1: Build the Rust backend
FROM rust:1.77-slim as builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
# Cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release 2>/dev/null; rm -rf src

COPY src ./src
RUN touch src/main.rs && cargo build --release

# Stage 2: Runtime
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash appuser

WORKDIR /app

# Copy backend binary
COPY --from=builder /app/target/release/telegram-drive-web .

# Copy frontend dist (will be mounted or built separately)
COPY --from=builder /app/../frontend/dist ./frontend/dist || true

# Create temp directory for uploads
RUN mkdir -p /tmp/telegram-uploads && chown appuser:appuser /tmp/telegram-uploads

# Create session directory
RUN mkdir -p /app/data && chown appuser:appuser /app/data

USER appuser

EXPOSE 8080

ENV RUST_LOG=info
ENV PORT=8080

# Health check for Render
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/api/health || exit 1

CMD ["./telegram-drive-web"]
