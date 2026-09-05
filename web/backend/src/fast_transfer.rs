//! High-speed parallel MTProto transfers.
//!
//! Telegram throttles throughput **per connection**, so the only real lever
//! is parallelism: multiple file parts in flight at once (sliding window).
//! grammers' `upload_stream` sends small files (<=10MB) strictly sequentially
//! and `iter_download` is sequential for every size — this module implements
//! the concurrent pattern (same as grammers' own big-file path) for all sizes:
//!
//! * upload: N workers × `SaveFilePart`/`SaveBigFilePart` (512KB parts)
//! * download: N workers × `GetFile` with ordered reassembly for streaming
//! * flood-aware: on `FLOOD_WAIT`, sleep the requested seconds (capped 120s),
//!   halve the in-flight window, then recover transiently
//!   (`min(original, cur + 1)` on next success) instead of permanent halving

use bytes::Bytes;
use futures::stream::{FuturesUnordered, StreamExt};
use grammers_client::media::{Downloadable, Media, Uploaded};
use grammers_client::Client;
use grammers_mtsender::InvocationError;
use grammers_tl_types as tl;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

pub const PART_SIZE: usize = 512 * 1024;
/// Telegram requires `saveBigFilePart` above this size.
const BIG_FILE_THRESHOLD: usize = 10 * 1024 * 1024;
const MAX_RETRIES: u32 = 4;

/// Worker count from `TG_WORKERS` env (default 8, clamped 1..=12).
pub fn worker_count() -> usize {
    std::env::var("TG_WORKERS")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(8)
        .clamp(1, 12)
}

/// If this is a flood-wait error, return the requested wait seconds.
fn flood_wait_secs(e: &InvocationError) -> Option<u64> {
    if let InvocationError::Rpc(rpc) = e {
        if rpc.name.contains("FLOOD") {
            return Some(rpc.value.unwrap_or(5).max(1) as u64);
        }
    }
    None
}

async fn sleep_capped(secs: u64) {
    tokio::time::sleep(Duration::from_secs(secs.min(120))).await;
}

/// Halve an atomic worker window, minimum 1.
fn shrink_window(window: &AtomicUsize) {
    let cur = window.load(Ordering::SeqCst);
    window.store((cur / 2).max(1), Ordering::SeqCst);
}

/// Transient recovery: on success, grow the window by one up to `max`.
/// Flood backoffs therefore only briefly reduce parallelism instead of
/// permanently halving throughput for the rest of the transfer.
fn grow_window(window: &AtomicUsize, max: usize) {
    let cur = window.load(Ordering::SeqCst);
    if cur < max {
        window.store((cur + 1).min(max), Ordering::SeqCst);
    }
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/// Upload one small-file part with flood-aware retries.
/// Takes `Bytes` so retries only refcount-clone; the single `to_vec()` per
/// RPC attempt is the only copy (Telegram API needs an owned `Vec<u8>`).
async fn send_small_part(
    client: Client,
    file_id: i64,
    part: i32,
    bytes: Bytes,
    window: Arc<AtomicUsize>,
    max_window: usize,
) -> Result<(), String> {
    for attempt in 0..MAX_RETRIES {
        // Reuse the shared buffer; only copy once into the RPC payload.
        let payload: Vec<u8> = bytes.to_vec();
        match client
            .invoke(&tl::functions::upload::SaveFilePart {
                file_id,
                file_part: part,
                bytes: payload,
            })
            .await
        {
            Ok(true) => {
                grow_window(&window, max_window);
                return Ok(());
            }
            Ok(false) => return Err("server refused file part".to_string()),
            Err(e) => {
                if let Some(s) = flood_wait_secs(&e) {
                    log::warn!("upload flood-wait {}s (part {}), shrinking window", s, part);
                    sleep_capped(s).await;
                    shrink_window(&window);
                    continue;
                }
                if attempt + 1 == MAX_RETRIES {
                    return Err(e.to_string());
                }
                tokio::time::sleep(Duration::from_millis(200 * (attempt + 1) as u64)).await;
            }
        }
    }
    Err("part retries exhausted".to_string())
}

/// Upload one big-file part with flood-aware retries.
async fn send_big_part(
    client: Client,
    file_id: i64,
    part: i32,
    total_parts: i32,
    bytes: Bytes,
    window: Arc<AtomicUsize>,
    max_window: usize,
) -> Result<(), String> {
    for attempt in 0..MAX_RETRIES {
        let payload: Vec<u8> = bytes.to_vec();
        match client
            .invoke(&tl::functions::upload::SaveBigFilePart {
                file_id,
                file_part: part,
                file_total_parts: total_parts,
                bytes: payload,
            })
            .await
        {
            Ok(true) => {
                grow_window(&window, max_window);
                return Ok(());
            }
            Ok(false) => return Err("server refused big file part".to_string()),
            Err(e) => {
                if let Some(s) = flood_wait_secs(&e) {
                    log::warn!("upload flood-wait {}s (part {}), shrinking window", s, part);
                    sleep_capped(s).await;
                    shrink_window(&window);
                    continue;
                }
                if attempt + 1 == MAX_RETRIES {
                    return Err(e.to_string());
                }
                tokio::time::sleep(Duration::from_millis(300 * (attempt + 1) as u64)).await;
            }
        }
    }
    Err("part retries exhausted".to_string())
}

/// Upload a file from disk to Telegram using N parallel part workers.
/// Small files (<=10MB): read once (<=10MB RAM), md5 in order, concurrent
/// `SaveFilePart`. Big files: per-worker file handles (positional reads, no
/// shared `Mutex<File>` serialization) + atomic part counter + read-ahead
/// buffer pool, concurrent `SaveBigFilePart`. RAM stays bounded on the hot path.
pub async fn upload_file_parallel(
    client: &Client,
    path: &std::path::Path,
    size: u64,
    name: String,
) -> Result<Uploaded, String> {
    let file_id: i64 = rand::random();
    let name = if name.is_empty() { "a".to_string() } else { name };
    let total_parts = ((size as usize + PART_SIZE - 1) / PART_SIZE) as i32;
    let workers = worker_count().min(total_parts.max(1) as usize);
    let window = Arc::new(AtomicUsize::new(workers));
    let max_window = workers;

    if (size as usize) <= BIG_FILE_THRESHOLD {
        // ---- small path: sequential disk read, parallel network ----
        let data = tokio::fs::read(path).await.map_err(|e| e.to_string())?;
        let mut parts: Vec<(i32, Bytes)> = Vec::with_capacity(total_parts as usize);
        let mut md5 = md5::Context::new();
        for (i, chunk) in data.chunks(PART_SIZE).enumerate() {
            md5.consume(chunk);
            // One copy into a refcounted buffer; retries only bump the refcount.
            parts.push((i as i32, Bytes::copy_from_slice(chunk)));
        }
        // `data` no longer needed — free before fan-out.
        drop(data);
        let mut tasks = FuturesUnordered::new();
        for (part, bytes) in parts {
            // keep the sliding window bounded
            while tasks.len() >= window.load(Ordering::SeqCst) {
                match tasks.next().await {
                    Some(Ok(())) => {}
                    Some(Err(e)) => return Err(e),
                    None => break,
                }
            }
            let c = client.clone();
            let w = window.clone();
            tasks.push(async move { send_small_part(c, file_id, part, bytes, w, max_window).await });
        }
        while let Some(r) = tasks.next().await {
            r?;
        }
        let digest = format!("{:x}", md5.finalize());
        Ok(Uploaded::from_raw(
            tl::types::InputFile {
                id: file_id,
                parts: total_parts,
                name,
                md5_checksum: digest,
            }
            .into(),
        ))
    } else {
        // ---- big path: per-worker handles + buffer pool, parallel network ----
        // Each part is read via its own `File::open` + positional
        // `seek(offset)` + `read_exact`, so disk reads never serialize on a
        // single `Arc<Mutex<File>>`. A small read-ahead buffer pool recycles
        // 512KB allocations instead of allocating from scratch per part.
        let owned_path = path.to_path_buf();
        let pool: Arc<std::sync::Mutex<Vec<Vec<u8>>>> =
            Arc::new(std::sync::Mutex::new(Vec::with_capacity(workers * 2)));
        let next_part = Arc::new(std::sync::atomic::AtomicI64::new(0));

        // Stream parts: read ahead only as fast as the window drains.
        let mut tasks = FuturesUnordered::new();
        let mut eof = false;
        while !eof || !tasks.is_empty() {
            while !eof && tasks.len() < window.load(Ordering::SeqCst) {
                let part = next_part.fetch_add(1, Ordering::SeqCst);
                if part >= total_parts as i64 {
                    eof = true;
                    break;
                }
                let offset = part as u64 * PART_SIZE as u64;
                let len = ((size - offset).min(PART_SIZE as u64)) as usize;
                // Acquire a pooled buffer (reuse allocation when available).
                let mut buf: Vec<u8> = pool
                    .lock()
                    .map(|mut p| p.pop())
                    .unwrap_or(None)
                    .unwrap_or_else(|| Vec::with_capacity(PART_SIZE));
                buf.resize(len, 0);
                // Per-worker independent handle: open + positional read.
                // No shared mutex — the OS handles concurrent opens.
                {
                    let mut f = tokio::fs::File::open(&owned_path)
                        .await
                        .map_err(|e| e.to_string())?;
                    f.seek(std::io::SeekFrom::Start(offset))
                        .await
                        .map_err(|e| e.to_string())?;
                    f.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
                }
                let payload = Bytes::from(buf);
                let c = client.clone();
                let w = window.clone();
                let pool_clone = pool.clone();
                tasks.push(async move {
                    let r =
                        send_big_part(c, file_id, part as i32, total_parts, payload, w, max_window)
                            .await;
                    // Recycle one 512KB allocation back into the pool so the
                    // read-ahead buffers stay bounded (amortizes alloc churn).
                    if let Ok(mut p) = pool_clone.lock() {
                        if p.len() < max_window * 2 {
                            p.push(Vec::with_capacity(PART_SIZE));
                        }
                    }
                    r
                });
            }
            if eof && tasks.is_empty() {
                break;
            }
            match tasks.next().await {
                Some(Ok(())) => {}
                Some(Err(e)) => return Err(e),
                None => {
                    if eof {
                        break;
                    }
                }
            }
        }
        Ok(Uploaded::from_raw(
            tl::types::InputFileBig {
                id: file_id,
                parts: total_parts,
                name,
            }
            .into(),
        ))
    }
}

// ---------------------------------------------------------------------------
// Download (ordered stream)
// ---------------------------------------------------------------------------

/// Fetch one 512KB part, following DC migrations, with flood-aware retries.
async fn fetch_part(
    client: &Client,
    location: &tl::enums::InputFileLocation,
    offset: i64,
) -> Result<Vec<u8>, InvocationError> {
    let mut dc: Option<i32> = None;
    for attempt in 0..MAX_RETRIES {
        let req = tl::functions::upload::GetFile {
            precise: true,
            cdn_supported: false,
            location: location.clone(),
            offset,
            limit: PART_SIZE as i32,
        };
        let res = match dc {
            Some(d) => client.invoke_in_dc(d, &req).await,
            None => client.invoke(&req).await,
        };
        match res {
            Ok(tl::enums::upload::File::File(f)) => return Ok(f.bytes),
            Ok(tl::enums::upload::File::CdnRedirect(_)) => {
                return Err(InvocationError::Io(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    "unexpected CDN redirect",
                )))
            }
            Err(InvocationError::Rpc(err)) if err.code == 303 => {
                dc = Some(err.value.unwrap_or(0) as i32);
                continue;
            }
            Err(e) => {
                if let Some(s) = flood_wait_secs(&e) {
                    log::warn!("download flood-wait {}s (offset {})", s, offset);
                    sleep_capped(s).await;
                    continue;
                }
                if attempt + 1 == MAX_RETRIES {
                    return Err(e);
                }
                tokio::time::sleep(Duration::from_millis(200 * (attempt + 1) as u64)).await;
            }
        }
    }
    Err(InvocationError::Io(std::io::Error::new(
        std::io::ErrorKind::TimedOut,
        "part fetch retries exhausted",
    )))
}

/// Result of evaluating Range/If-None-Match preconditions for a file response.
pub enum RangeDecision {
    /// Send the whole file (200).
    Full,
    /// Send bytes [start, end] inclusive (206).
    Partial(u64, u64),
    /// Unsatisfiable (416). Client should have checked ETag first.
    Unsatisfiable,
    /// ETag matches (304).
    NotModified,
}

/// Evaluate `If-None-Match` + `Range` for an immutable file of `total` bytes.
/// `etag` must be a quoted string like `"fid-mid"`.
pub fn range_decision(req: &actix_web::HttpRequest, etag: &str, total: u64) -> RangeDecision {
    if let Some(v) = req.headers().get("If-None-Match") {
        if v.as_bytes() == etag.as_bytes() || v.as_bytes() == b"*" {
            return RangeDecision::NotModified;
        }
    }
    let Some(h) = req
        .headers()
        .get("Range")
        .and_then(|v| v.to_str().ok())
    else {
        return RangeDecision::Full;
    };
    match parse_range(h, total) {
        Some((s, e)) => RangeDecision::Partial(s, e),
        None => RangeDecision::Unsatisfiable,
    }
}

/// Parse an HTTP `Range` header. Returns (start, end-inclusive).
/// Supports `bytes=S-`, `bytes=S-E`, `bytes=-N` (suffix). Total must be known.
pub fn parse_range(header: &str, total: u64) -> Option<(u64, u64)> {
    let h = header.trim();
    let h = h.strip_prefix("bytes=")?;
    if total == 0 {
        return None;
    }
    if let Some(suffix) = h.strip_prefix('-') {
        let n: u64 = suffix.trim().parse().ok()?;
        if n == 0 {
            return None;
        }
        let n = n.min(total);
        return Some((total - n, total - 1));
    }
    let mut it = h.splitn(2, '-');
    let start: u64 = it.next()?.trim().parse().ok()?;
    let end_opt = it.next().unwrap_or("").trim();
    if start >= total {
        return None;
    }
    let end = if end_opt.is_empty() {
        total - 1
    } else {
        end_opt.parse::<u64>().ok()?.min(total - 1)
    };
    if end < start {
        return None;
    }
    Some((start, end))
}

/// Stream a media document as ordered bytes.
/// Files of <=2 parts use the plain sequential iterator (less overhead);
/// larger files fetch parts concurrently and reassemble in order.
pub fn download_stream(
    client: &Client,
    media: Media,
) -> impl futures::Stream<Item = Result<Bytes, actix_web::Error>> {
    download_range_stream(client, media, None)
}

/// Same as [`download_stream`], but only the byte range `[start, end]`
/// (inclusive) is fetched from Telegram — seeks never re-download the file.
pub fn download_range_stream(
    client: &Client,
    media: Media,
    range: Option<(u64, u64)>,
) -> impl futures::Stream<Item = Result<Bytes, actix_web::Error>> {
    let client = client.clone();
    async_stream::stream! {
        if let Some(data) = media.to_data() {
            let sliced: &[u8] = match range {
                Some((s, e)) => {
                    let s = (s as usize).min(data.len());
                    let e = ((e as usize) + 1).min(data.len());
                    if e <= s { &[][..] } else { &data[s..e] }
                }
                None => &data[..],
            };
            yield Ok::<_, actix_web::Error>(Bytes::from(sliced.to_vec()));
            return;
        }
        let loc = media.to_raw_input_location();
        let size = media.size().unwrap_or(0);
        let (location, total) = match (loc, size) {
            (Some(l), s) if s > 0 => (l, s),
            _ => {
                // Unknown size/location: fall back to sequential iterator.
                let mut iter = client.iter_download(&media);
                loop {
                    match iter.next().await {
                        Ok(Some(chunk)) => yield Ok(Bytes::from(chunk)),
                        Ok(None) => break,
                        Err(e) => {
                            yield Err(actix_web::error::ErrorInternalServerError(e.to_string()));
                            break;
                        }
                    }
                }
                return;
            }
        };
        let (start, end) = match range {
            Some((s, e)) if s < total as u64 => (s, e.min(total as u64 - 1)),
            Some(_) => {
                yield Err(actix_web::error::ErrorInternalServerError("range start beyond file size"));
                return;
            }
            None => (0, total as u64 - 1),
        };
        let first_part = (start / PART_SIZE as u64) as i64;
        let last_part = (end / PART_SIZE as u64) as i64;
        let total_parts = last_part - first_part + 1;
        // Small full-file reads keep the plain sequential iterator (less overhead).
        if range.is_none() && total <= 2 * PART_SIZE {
            let mut iter = client.iter_download(&media);
            loop {
                match iter.next().await {
                    Ok(Some(chunk)) => yield Ok(Bytes::from(chunk)),
                    Ok(None) => break,
                    Err(e) => {
                        yield Err(actix_web::error::ErrorInternalServerError(e.to_string()));
                        break;
                    }
                }
            }
            return;
        }
        let workers = worker_count().min(total_parts as usize);
        let window = Arc::new(AtomicUsize::new(workers));
        let max_window = workers;
        let mut next_fetch: i64 = first_part;
        let mut next_yield: i64 = first_part;
        let mut yielded: i64 = 0;
        let mut inflight = FuturesUnordered::new();
        let mut buf: BTreeMap<i64, Vec<u8>> = BTreeMap::new();
        // request window as absolute [start, end) byte offsets
        let end_excl = end + 1;

        loop {
            while inflight.len() < window.load(Ordering::SeqCst) && next_fetch <= last_part {
                let part = next_fetch;
                next_fetch += 1;
                let off = part * PART_SIZE as i64;
                let c = client.clone();
                let l = location.clone();
                let w = window.clone();
                inflight.push(async move {
                    let r = fetch_part(&c, &l, off).await;
                    if let Err(ref e) = r {
                        if flood_wait_secs(e).is_some() {
                            shrink_window(&w);
                        }
                    } else {
                        // Transient backoff: recover one slot per success.
                        grow_window(&w, max_window);
                    }
                    r.map(|b| (part, b))
                });
            }
            if inflight.is_empty() {
                break;
            }
            match inflight.next().await {
                Some(Ok((part, bytes))) => {
                    if bytes.is_empty() {
                        while let Some(b) = buf.remove(&next_yield) {
                            yield Ok(Bytes::from(slice_part(&b, next_yield, start, end_excl)));
                            next_yield += 1;
                        }
                        break;
                    }
                    buf.insert(part, bytes);
                    while let Some(b) = buf.remove(&next_yield) {
                        yield Ok(Bytes::from(slice_part(&b, next_yield, start, end_excl)));
                        next_yield += 1;
                        yielded += 1;
                        if yielded >= total_parts {
                            break;
                        }
                    }
                    if yielded >= total_parts {
                        break;
                    }
                }
                Some(Err(e)) => {
                    yield Err(actix_web::error::ErrorInternalServerError(e.to_string()));
                    break;
                }
                None => break,
            }
        }
    }
}

/// Slice a fetched 512KB part down to the requested `[start, end)` window
/// (absolute byte offsets). Parts are fetched by absolute part index, so the
/// intersection is computed directly — no caller-side bookkeeping needed.
fn slice_part(b: &[u8], part_idx: i64, start: u64, end_excl: u64) -> Vec<u8> {
    let p = part_idx as u64 * PART_SIZE as u64;
    let from = start.saturating_sub(p).min(b.len() as u64) as usize;
    let to = end_excl.saturating_sub(p).min(b.len() as u64) as usize;
    if to <= from {
        Vec::new()
    } else {
        b[from..to].to_vec()
    }
}
