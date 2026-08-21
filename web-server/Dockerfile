# Stage 1: Build Frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app
COPY web-server/frontend/package*.json ./
RUN npm install
COPY web-server/frontend/ ./
RUN npm run build

# Stage 2: Build Backend
FROM rust:latest AS backend-builder
WORKDIR /server
RUN apt-get update && apt-get install -y pkg-config libssl-dev git && rm -rf /var/lib/apt/lists/*
COPY web-server/Cargo.toml ./
# Create a dummy src/main.rs to build dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -rf src
COPY web-server/src ./src
RUN cargo build --release

# Stage 3: Final Image
FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=backend-builder /server/target/release/telegram-drive-web ./server
COPY --from=frontend-builder /app/dist ./dist

EXPOSE 8080
ENV PORT=8080
ENV RUST_LOG=info

CMD ["./server"]
