# Task report: Telegram creds from backend env (backend)

## Summary
Implemented backend support for Telegram credentials from env vars on branch
`feat/env-telegram-creds`, per the exact contract shared with the frontend worker.

## Changes (commit `ea86fd6` — "feat: telegram creds from backend env with request-code fallback")
- `web/backend/src/settings.rs`
  - Added `env_telegram_api_hash()` (`TG_API_HASH`, fallback `TELEGRAM_API_HASH`;
    trimmed; `None` when unset/empty) and `env_telegram_phone()` (`TG_PHONE` only).
  - No `Settings` struct changes — secrets are read fresh from env on every use,
    never persisted or serialized via `GET /api/settings`.
  - Added one self-contained unit test (`env_telegram_creds_trimmed_fallback_and_empty`):
    TG_ precedence over TELEGRAM_ for hash, trimming, unset/empty/whitespace → `None`.
- `web/backend/src/auth.rs` (`request_code`)
  - Request value wins when valid; otherwise env fallback: empty `api_hash` →
    `env_telegram_api_hash()`; empty `phone` → `env_telegram_phone()`;
    `api_id < 1000` → `TELEGRAM_API_ID`/`TG_API_ID` env (same parse order as
    `get_client`), else 0 → existing `API ID {} invalid...` BadRequest.
  - All pre-existing validation messages unchanged; resolved id stored in
    `state.api_id` and `settings.telegram_api_id` (hash/phone never persisted);
    `request_login_code(&phone, &api_hash)` uses resolved values.
  - Everything below the credential block unchanged.
- `web/backend/src/main.rs` (`version()`)
  - `GET /api/version` gains `"tg_env": {"api_id", "api_hash", "phone"}` —
    booleans only, never secret values (`api_id` = env parses to `i32`).

## Tests
- `cargo test` in `web/backend`: **72 passed, 0 failed**.
- Note: first run had 1 failure — my three new env tests raced each other via
  parallel threads mutating shared process env; merged them into a single test
  (no other test touches `TG_API_HASH`/`TELEGRAM_API_HASH`/`TG_PHONE`), then green.
  (Existing `share.rs:19` reads the same hash env vars at runtime only, not in tests.)

## Self-review (completeness / quality / YAGNI)
- Contract points verified: `tg_env` shape booleans-only; empty `api_hash`/`phone`
  and `api_id < 1000` fall back to env; missing-env errors byte-identical to before
  (the api_id message still formats `req.api_id`, so the missing-env case is unchanged).
- No other env names introduced; no secret values logged or returned anywhere.
- `Settings` struct untouched (`models.rs`); `save_settings_handler` behavior unchanged.
- No new dependencies; `graphify update .` run successfully after commit.

## Concerns
- Minor: when env supplies an invalid small api_id (e.g. `TG_API_ID=5`) while the
  request also has `api_id < 1000`, the error message echoes the request's id, not the
  resolved one. Missing-env behavior is exactly preserved, so this was kept deliberately.
