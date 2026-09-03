FROM rust:latest as builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:trixie-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/telegram-drive-web /usr/local/bin/telegram-drive
COPY --from=builder /app/.env.example /app/.env
EXPOSE 8080
CMD ["telegram-drive"]
