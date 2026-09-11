//! Background MAIN → BACKUP replication (Options #1 + #2).
//!
//! Uploads enqueue a [`ReplicateJob`] the moment they land in MAIN; a worker
//! forwards them server-side (no re-upload, fast) with retry + backoff. A
//! JSONL ledger records completed copies so restarts never duplicate files.

use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock};

use crate::utils::resolve_peer_ref;
use crate::AppState;

/// One pending MAIN → BACKUP copy.
#[derive(Clone, Debug)]
pub struct ReplicateJob {
    pub channel_id: i64,
    pub message_id: i32,
    pub attempts: u32,
    /// Earliest time this job may run (backoff). `None` = due now.
    pub not_before: Option<std::time::Instant>,
}

impl ReplicateJob {
    pub fn new(channel_id: i64, message_id: i32) -> Self {
        Self {
            channel_id,
            message_id,
            attempts: 0,
            not_before: None,
        }
    }

    pub fn is_due(&self) -> bool {
        self.not_before
            .map(|t| t <= std::time::Instant::now())
            .unwrap_or(true)
    }
}

/// FIFO queue that never holds the same message twice.
pub struct Outbox {
    queue: VecDeque<ReplicateJob>,
    pending: HashSet<(i64, i32)>,
}

impl Outbox {
    pub fn new() -> Self {
        Self {
            queue: VecDeque::new(),
            pending: HashSet::new(),
        }
    }

    /// Enqueue unless already queued. Returns true if newly queued.
    pub fn push_unique(&mut self, job: ReplicateJob) -> bool {
        let key = (job.channel_id, job.message_id);
        if !self.pending.insert(key) {
            return false;
        }
        self.queue.push_back(job);
        true
    }

    pub fn pop_front(&mut self) -> Option<ReplicateJob> {
        let job = self.queue.pop_front()?;
        self.pending.remove(&(job.channel_id, job.message_id));
        Some(job)
    }

    /// Pop the first due job, rotating not-yet-due jobs to the back.
    /// Returns `None` when the outbox is empty or nothing is due yet.
    pub fn pop_due(&mut self) -> Option<ReplicateJob> {
        for _ in 0..self.queue.len() {
            let due = self.queue.front().map(|j| j.is_due()).unwrap_or(false);
            if due {
                return self.pop_front();
            }
            let job = self.queue.pop_front().unwrap();
            self.queue.push_back(job);
        }
        None
    }

    /// How long until the next retry is due (`None` when everything is due
    /// now or the outbox is empty).
    pub fn time_until_due(&self) -> Option<Duration> {
        self.queue
            .iter()
            .filter_map(|j| j.not_before)
            .min()
            .map(|t| t.saturating_duration_since(std::time::Instant::now()))
    }
}

/// Backoff between retries: 10s, 20s, 40s … capped at 320s.
pub fn retry_delay_secs(attempts: u32) -> u64 {
    10u64.saturating_mul(1u64 << attempts.min(5))
}

/// Ledger file recording completed copies (survives restarts).
pub fn ledger_path() -> PathBuf {
    PathBuf::from(std::env::var("BACKUP_LEDGER_PATH").unwrap_or_else(|_| "backup_ledger.jsonl".into()))
}

pub fn already_copied_at(path: &Path, main_id: i64) -> bool {
    let content = std::fs::read_to_string(path).unwrap_or_default();
    content.lines().any(|l| {
        serde_json::from_str::<serde_json::Value>(l)
            .ok()
            .and_then(|v| v.get("main").and_then(|m| m.as_i64()))
            == Some(main_id)
    })
}

pub fn already_copied(main_id: i64) -> bool {
    already_copied_at(&ledger_path(), main_id)
}

pub fn record_copy_at(path: &Path, main_id: i64, backup_id: i64) {
    use std::fmt::Write as _;
    let mut line = serde_json::json!({"main": main_id, "backup": backup_id}).to_string();
    line.write_char('\n').ok();
    use std::io::Write as _;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = f.write_all(line.as_bytes());
    }
}

pub fn record_copy(main_id: i64, backup_id: i64) {
    record_copy_at(&ledger_path(), main_id, backup_id);
}

/// Server-side forward of one MAIN message to the backup channel.
/// Returns the backup message id. Bytes are never re-uploaded.
pub async fn replicate_one(
    client: &grammers_client::Client,
    backup_channel_id: i64,
    main_channel_id: i64,
    message_id: i32,
    peer_cache: &Arc<RwLock<std::collections::HashMap<i64, grammers_client::peer::Peer>>>,
) -> Result<i64, String> {
    let src = resolve_peer_ref(client, Some(main_channel_id), peer_cache).await?;
    let dst = resolve_peer_ref(client, Some(backup_channel_id), peer_cache).await?;
    let updates = client
        .forward_messages(dst, &[message_id], src)
        .await
        .map_err(|e| e.to_string())?;
    let backup_id = updates
        .into_iter()
        .flatten()
        .map(|m| m.id() as i64)
        .filter(|id| *id > 0)
        .max()
        .unwrap_or(0);
    Ok(backup_id)
}

/// Channel capacity for pending replication jobs (backpressure via try_send).
pub const OUTBOX_CAPACITY: usize = 1024;

/// Best-effort enqueue from upload paths and the watcher.
pub fn enqueue(state: &AppState, job: ReplicateJob) {
    if already_copied(job.message_id as i64) {
        return;
    }
    match state.replicate_tx.try_send(job.clone()) {
        Ok(_) => log::info!(
            "Replication queued: message {} (channel {})",
            job.message_id,
            job.channel_id
        ),
        Err(_) => log::warn!(
            "Replication outbox full, dropped message {}",
            job.message_id
        ),
    }
}

/// Long-lived worker: forwards queued jobs with retry + ledger. Run once at
/// startup via `tokio::spawn`. Never exits on job errors.
pub async fn replication_worker(
    state: actix_web::web::Data<AppState>,
    mut rx: mpsc::Receiver<ReplicateJob>,
) {
    let mut outbox = Outbox::new();
    loop {
        // Drain everything currently due.
        while let Some(mut job) = outbox.pop_due() {
            // Skip anything already copied (e.g. by an earlier attempt).
            if already_copied(job.message_id as i64) {
                continue;
            }
            let backup_id = match crate::storage::backup_id(&state) {
                Some(id) => id,
                None => {
                    log::warn!("Replication skipped: backup channel not provisioned");
                    break;
                }
            };
            let client = match crate::auth::get_client(&state).await {
                Ok(c) => c,
                Err(e) => {
                    log::warn!("Replication: telegram offline ({}), retrying job {} later", e, job.message_id);
                    job.attempts += 1;
                    job.not_before = Some(
                        std::time::Instant::now()
                            + Duration::from_secs(60),
                    );
                    outbox.push_unique(job);
                    break;
                }
            };
            match replicate_one(
                &client,
                backup_id,
                job.channel_id,
                job.message_id,
                &state.peer_cache,
            )
            .await
            {
                Ok(backup_msg) => {
                    record_copy(job.message_id as i64, backup_msg);
                    log::info!(
                        "Replicated message {} -> backup {}",
                        job.message_id,
                        backup_msg
                    );
                }
                Err(e) => {
                    job.attempts += 1;
                    if job.attempts > 5 {
                        log::error!(
                            "Replication gave up on message {}: {}",
                            job.message_id,
                            e
                        );
                    } else {
                        let delay = retry_delay_secs(job.attempts);
                        log::warn!(
                            "Replication failed for message {} (attempt {}): {}. Retrying in {}s",
                            job.message_id,
                            job.attempts,
                            e,
                            delay
                        );
                        job.not_before = Some(
                            std::time::Instant::now() + Duration::from_secs(delay),
                        );
                        outbox.push_unique(job);
                    }
                }
            }
            // Pick up jobs that arrived while we were working.
            while let Ok(job) = rx.try_recv() {
                outbox.push_unique(job);
            }
        }
        // Park until new work arrives or the next retry comes due.
        let wait_for = outbox.time_until_due();
        tokio::select! {
            biased;
            res = rx.recv() => match res {
                Some(job) => {
                    outbox.push_unique(job);
                }
                None => break,
            },
            _ = async {
                match wait_for {
                    Some(d) => tokio::time::sleep(d).await,
                    None => std::future::pending().await,
                }
            } => {}
        }
    }
}

/// 24/7 watcher (Option #2): copies files dropped into MAIN from outside the
/// app (e.g. phone). Our own sends are already enqueued at upload time and
/// skipped here via the ledger. Polls MAIN's recent history on an interval —
/// no updates-stream plumbing required — and heals itself on any error.
/// Run once at startup via `tokio::spawn`.
pub async fn watch_main_channel(state: actix_web::web::Data<AppState>) {
    const POLL_SECS: u64 = 20;
    let mut seen_max: i32 = 0;
    loop {
        let main = match crate::storage::main_id(&state) {
            Some(id) => id,
            None => {
                tokio::time::sleep(Duration::from_secs(30)).await;
                continue;
            }
        };
        let client = match crate::auth::get_client(&state).await {
            Ok(c) => c,
            Err(_) => {
                tokio::time::sleep(Duration::from_secs(30)).await;
                continue;
            }
        };
        let peer = match crate::utils::resolve_peer_ref(&client, Some(main), &state.peer_cache).await
        {
            Ok(p) => p,
            Err(e) => {
                log::warn!("Storage watcher: cannot resolve MAIN ({}), retrying…", e);
                tokio::time::sleep(Duration::from_secs(30)).await;
                continue;
            }
        };
        let mut iter = client.iter_messages(peer);
        let mut checked = 0;
        let mut batch_max = seen_max;
        while let Ok(Some(msg)) = iter.next().await {
            checked += 1;
            if checked > 10 {
                break;
            }
            batch_max = batch_max.max(msg.id());
            if msg.id() <= seen_max || msg.outgoing() || msg.media().is_none() {
                continue;
            }
            log::info!("Watcher: new external file {} in MAIN", msg.id());
            enqueue(&state, ReplicateJob::new(main, msg.id()));
        }
        seen_max = batch_max;
        tokio::time::sleep(Duration::from_secs(POLL_SECS)).await;
    }
}

/// In-memory outbox handle shared via [`AppState`].
pub type ReplicateSender = mpsc::Sender<ReplicateJob>;

pub fn channel() -> (ReplicateSender, mpsc::Receiver<ReplicateJob>) {
    mpsc::channel(OUTBOX_CAPACITY)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outbox_dedups_same_message() {
        let mut outbox = Outbox::new();
        assert!(outbox.push_unique(ReplicateJob::new(10, 45)));
        assert!(!outbox.push_unique(ReplicateJob::new(10, 45)));
        assert!(outbox.push_unique(ReplicateJob::new(10, 46)));
        assert!(outbox.pop_front().is_some());
        assert!(outbox.pop_front().is_some());
        assert!(outbox.pop_front().is_none());
    }

    #[test]
    fn outbox_pop_returns_fifo() {
        let mut outbox = Outbox::new();
        outbox.push_unique(ReplicateJob::new(10, 45));
        outbox.push_unique(ReplicateJob::new(10, 46));
        assert_eq!(outbox.pop_front().unwrap().message_id, 45);
        // After pop the same message may be queued again (e.g. retry).
        assert!(outbox.push_unique(ReplicateJob::new(10, 45)));
    }

    #[test]
    fn retry_delay_backs_off_and_caps() {
        assert_eq!(retry_delay_secs(0), 10);
        assert_eq!(retry_delay_secs(1), 20);
        assert_eq!(retry_delay_secs(2), 40);
        assert_eq!(retry_delay_secs(99), 320);
    }

    #[test]
    fn ledger_records_and_recalls_copies() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ledger.jsonl");
        assert!(!already_copied_at(&path, 45));
        record_copy_at(&path, 45, 77);
        assert!(already_copied_at(&path, 45));
        assert!(!already_copied_at(&path, 46));
    }
}
