# Kaya Improve

Super Admin monitor: `/monitor/improve`. The entry sits beside Settings in the existing WA monitor. API access also requires the existing Super Admin session. Call centre users cannot retrieve settings, reviews or backups.

The master switch and each run start disabled or at their saved schedule; initial master default is off. Save applies changes; unsaved choices have no effect. Disabling stops new audit runs, not normal Kaya replies. In-flight audits may finish.

## Trigger and frequency

Automatic runs happen only after a successful contact create/update by Kaya in Bigin. There is no independent scheduler or after-each-message hook. Manual Run now remains available to Super Admins. The Bigin success path passes the conversation snapshot to the audit in background work on the existing function. It consumes compute and database usage, but adds no scheduled invocations. Chats never successfully pushed by Kaya, unrelated records created directly in Bigin, or failed pushes are outside this trigger.

Frequency dropdowns control minimum intervals between event-triggered runs. After every Bigin push runs immediately; hourly/daily/custom choices become eligible after the gap, then wait for the next successful push. Off disables that run.

## Current implementation

- Confirmation Audit: read-only audit after the Bigin push, including booking/callback evidence. This is not an additional pre-send safety validator. Existing webhook rules remain responsible for bookings.
- Reply Check: deterministic checks for repeated replies, contact words stored as names, and reversed callback direction.
- Conversation Outcome: outcome review after the successful Bigin push.
- Detailed Review: groups flagged records into rule-based suggested corrections; no AI analysis yet.
- Improvement & Regression: aggregates recurring flags and executes detector fixtures including successful examples. These are not full-model replay tests.
- Automatic checks use the just-pushed conversation snapshot. Manual scans inspect the most recently active 200 conversations; the UI lists 100 latest reviews and 50 latest runs. Larger manual backlogs need pagination.
- A stored booking is explicitly marked as needing verification. Live Bigin event validation, semantic consent verification and attendance tracking are not implemented here.
- No automatic prompt/code publishing. It stays unavailable until locked rules are approved, full Kaya-response regression tests are connected, and the publishing/rollback connection is configured.

## Recovery

Every settings save / restore records the before and after configuration atomically. Optimistic revision checks reject stale saves. Only Super Admin can restore settings. Restoring schedules can re-enable their previous enabled state; the restore is itself backed up.

Every code release must have a committed changed-file snapshot. Run `node scripts/kaya-backup.mjs create <base-commit>` after final edits, before committing. The ZIP download includes `before/`, `after/` and a hash manifest. New/deleted files are represented explicitly. The history manifest is itself versioned by Git rather than recursively copied into itself. CI rejects missing or stale snapshots. All repository paths, including workflow files, are covered; secrets and environment files are excluded.

To recover code, use a clean branch and `node scripts/kaya-backup.mjs restore <release-id>`. Review the restored diff, run checks, create a fresh snapshot and commit. Vercel must successfully deploy the restore. Download/restore of files does not reverse customer messages, CRM actions, database schema or environment variables. No one-click production code rollback is connected yet.

## Storage

`database/kaya-improve.sql` defines private monitor tables and an invoker-rights transactional save function. During provisioning, replace `SERVER_SECRET_SHA256` with SHA-256 of a new dedicated secret. Store the plaintext only as server-side `KAYA_IMPROVE_SECRET`. RLS checks the dedicated request header. No browser database access or public RLS policy is permitted. The existing anon key is reused only by the server-held client with that additional header. The new secret does not grant access to any other database tables.

Only the production Bigin success hook launches automatic audits. Existing nudge and inactive-lead cron timings are unchanged. No new cron job is introduced.
