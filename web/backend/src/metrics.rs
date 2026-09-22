//! Tier 3 #17 — Structured metrics endpoint (/metrics) + request counters.
//!
//! Exposes a Prometheus-style text endpoint that increments counters for
//! HTTP methods, status classes, and active in-flight requests. The counters
//! are process-local atomics, so they track per-instance metrics only.
//!
//! Structured logging (Tier 3 #17, second half): when `RUST_LOG_JSON=true`,
//! the startup init() uses a JSON formatter so log lines are machine-parseable.

use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};

/// Global request counters (per HTTP method × status class).
pub struct Counter {
    get_2xx: AtomicU64,
    get_4xx: AtomicU64,
    get_5xx: AtomicU64,
    post_2xx: AtomicU64,
    post_4xx: AtomicU64,
    post_5xx: AtomicU64,
    in_flight: AtomicU64,
}

impl Counter {
    pub const fn new() -> Self {
        Self {
            get_2xx: AtomicU64::new(0),
            get_4xx: AtomicU64::new(0),
            get_5xx: AtomicU64::new(0),
            post_2xx: AtomicU64::new(0),
            post_4xx: AtomicU64::new(0),
            post_5xx: AtomicU64::new(0),
            in_flight: AtomicU64::new(0),
        }
    }

    pub fn inc(&self, method: &str, status: u16) {
        let class = status / 100;
        match (method.to_uppercase().as_str(), class) {
            ("GET", 2) => { self.get_2xx.fetch_add(1, Ordering::Relaxed); }
            ("GET", 4) => { self.get_4xx.fetch_add(1, Ordering::Relaxed); }
            ("GET", 5) => { self.get_5xx.fetch_add(1, Ordering::Relaxed); }
            ("POST", 2) => { self.post_2xx.fetch_add(1, Ordering::Relaxed); }
            ("POST", 4) => { self.post_4xx.fetch_add(1, Ordering::Relaxed); }
            ("POST", 5) => { self.post_5xx.fetch_add(1, Ordering::Relaxed); }
            _ => {}
        };
    }

    pub fn in_flight_inc(&self) {
        self.in_flight.fetch_add(1, Ordering::Relaxed);
    }

    pub fn in_flight_dec(&self) {
        self.in_flight.fetch_sub(1, Ordering::Relaxed);
    }

    fn fmt_counter(name: &str, help: &str, val: u64) -> String {
        format!("# HELP {} {}\n# TYPE {} counter\n{} {}\n", name, help, name, name, val)
    }

    pub fn render(&self) -> String {
        let g2 = self.get_2xx.load(Ordering::Relaxed);
        let g4 = self.get_4xx.load(Ordering::Relaxed);
        let g5 = self.get_5xx.load(Ordering::Relaxed);
        let p2 = self.post_2xx.load(Ordering::Relaxed);
        let p4 = self.post_4xx.load(Ordering::Relaxed);
        let p5 = self.post_5xx.load(Ordering::Relaxed);
        let inflight = self.in_flight.load(Ordering::Relaxed);

        let mut out = String::new();
        out.push_str("# HELP telegram_drive_build_info Build metadata\n");
        out.push_str("# TYPE telegram_drive_build_info gauge\n");
        out.push_str(&format!(
            "telegram_drive_build_info{{version=\"{}\",commit=\"{}\"}} 1\n",
            env!("CARGO_PKG_VERSION"),
            std::env::var("BUILD_COMMIT").unwrap_or_else(|_| "dev".into())
        ));
        out.push_str(&Self::fmt_counter(
            "telegram_drive_http_requests_total",
            "Total HTTP requests by method and status class",
            0,
        ));
        out.push_str(&format!("telegram_drive_http_requests_total{{method=\"GET\",status=\"2xx\"}} {}\n", g2));
        out.push_str(&format!("telegram_drive_http_requests_total{{method=\"GET\",status=\"4xx\"}} {}\n", g4));
        out.push_str(&format!("telegram_drive_http_requests_total{{method=\"GET\",status=\"5xx\"}} {}\n", g5));
        out.push_str(&format!("telegram_drive_http_requests_total{{method=\"POST\",status=\"2xx\"}} {}\n", p2));
        out.push_str(&format!("telegram_drive_http_requests_total{{method=\"POST\",status=\"4xx\"}} {}\n", p4));
        out.push_str(&format!("telegram_drive_http_requests_total{{method=\"POST\",status=\"5xx\"}} {}\n", p5));
                out.push_str("# HELP telegram_drive_in_flight_requests\n# TYPE telegram_drive_in_flight_requests gauge\n");
        out.push_str(&format!("telegram_drive_in_flight_requests {}\n", inflight));
        out
    }
}

/// Process-global metrics registry.
pub static METRICS: std::sync::LazyLock<Counter> = std::sync::LazyLock::new(Counter::new);

/// `GET /api/metrics` — Prometheus-style text exposition.
pub async fn metrics_handler() -> actix_web::HttpResponse {
    actix_web::HttpResponse::Ok()
        .content_type("text/plain; version=0.0.4; charset=utf-8")
        .body(METRICS.render())
}

/// Initialise logging: JSON if `RUST_LOG_JSON=true`, else human-readable.
pub fn init_logging() {
    if std::env::var("RUST_LOG_JSON")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false)
    {
        let mut builder = env_logger::Builder::from_default_env();
        builder.format(|buf, record| {
            let ts = chrono::Utc::now().to_rfc3339();
            let level = record.level();
            let target = record.target();
            let msg = record.args();
            let line = format!(
                r#"{{"timestamp":"{}","level":"{}","target":"{}","message":{}}}"#,
                ts, level, target, serde_json::Value::String(msg.to_string())
            );
            buf.write_all(line.as_bytes()).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            buf.write_all(b"\n").map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            Ok(())
        });
        builder.init();
    } else {
        env_logger::init();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counter_increments_and_renders() {
        let c = Counter::new();
        c.inc("GET", 200);
        c.inc("GET", 200);
        c.inc("POST", 404);
        c.inc("GET", 500);
        c.in_flight_inc();
        c.in_flight_dec();
        let out = c.render();
        assert!(out.contains("telegram_drive_build_info"));
        assert!(out.contains("method=\"GET\",status=\"2xx\"} 2"));
        assert!(out.contains("method=\"POST\",status=\"4xx\"} 1"));
        assert!(out.contains("method=\"GET\",status=\"5xx\"} 1"));
        assert!(out.contains("telegram_drive_in_flight_requests 0"));
    }

    #[test]
    fn metrics_endpoint_returns_text() {
        let s = METRICS.render();
        assert!(s.starts_with("# HELP telegram_drive_build_info"));
    }
}
