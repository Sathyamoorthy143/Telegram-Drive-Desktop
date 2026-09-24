# env-creds-frontend report

## What changed
- `web/frontend/src/api.ts`: `getBackendCaps` return type gains `tg_env?: { api_id; api_hash; phone }`.
- `web/frontend/src/components/AuthWizard.tsx`:
  - Fetches caps on mount into `envCreds` (all-false default on error/absent → old-backend compatible).
  - Setup step hides API ID / API Hash inputs per flags; skips setup entirely when both set.
  - `handleSetupSubmit` validates only visible fields.
  - Phone step shows "Using the phone number configured on the server." when `phone` set; `handlePhoneSubmit` sends `""`/`0` sentinels for hidden fields, preserving `already_authorized` branch and error handling.
  - No secret values ever rendered (booleans only).
- New `web/frontend/src/components/AuthWizard.env.test.tsx` (jsdom): all-true hides inputs + `requestCode("", 0, "")`; all-false preserves existing inputs.

## Verification
- `npx tsc --noEmit`: clean.
- `npx vitest run src/components/AuthWizard.env.test.tsx`: 2/2 pass.

## Self-review
- Env absent → identical behavior (all inputs shown, same validation).
- YAGNI: no extra UI/config; back-to-setup button hidden only when setup is skipped.

## Notes
- `graphify update .` timed out after AST extraction pass (noted, moved on); commit hook also launched background rebuild.
- Commit: `dc6fbf2 feat: wizard skips server-configured telegram creds`.
