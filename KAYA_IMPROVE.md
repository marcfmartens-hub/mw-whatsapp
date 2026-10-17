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
- Detailed Review: groups flagged records into rule-based suggested corrections. The separate auto-approval stage uses AI for contact-language candidates.
- Improvement & Regression: aggregates recurring flags and executes detector fixtures including successful examples. These are not full-model replay tests.
- Automatic checks use the just-pushed conversation snapshot. Manual scans inspect the most recently active 200 conversations; the UI lists 100 latest reviews and 50 latest runs. Larger manual backlogs need pagination.
- A stored booking is explicitly marked as needing verification. Live Bigin event validation, semantic consent verification and attendance tracking are not implemented here.
- Automatic publishing is restricted to validated contact-language aliases. It remains blocked until the runtime GitHub connection and completion webhook are configured.

## Recovery

Every settings save / restore records the before and after configuration atomically. Optimistic revision checks reject stale saves. Only Super Admin can restore settings. Restoring schedules can re-enable their previous enabled state; the restore is itself backed up.

Every code release must have a committed changed-file snapshot. Run `node scripts/kaya-backup.mjs create <base-commit>` after final edits, before committing. The ZIP download includes `before/`, `after/` and a hash manifest. New/deleted files are represented explicitly. The history manifest is itself versioned by Git rather than recursively copied into itself. CI rejects missing or stale snapshots. All repository paths, including workflow files, are covered; secrets and environment files are excluded.

To recover code, use a clean branch and `node scripts/kaya-backup.mjs restore <release-id>`. Review the restored diff, run checks, create a fresh snapshot and commit. Vercel must successfully deploy the restore. Download/restore of files does not reverse customer messages, CRM actions, database schema or environment variables. Automatic learning releases have a tested restore path in the monitor when GitHub publishing is connected. Other repository code restores use the local script and a normal deployment.

## Storage

`database/kaya-improve.sql` defines private monitor tables and an invoker-rights transactional save function. During provisioning, replace `SERVER_SECRET_SHA256` with SHA-256 of a new dedicated secret. Store the plaintext only as server-side `KAYA_IMPROVE_SECRET`. RLS checks the dedicated request header. No browser database access or public RLS policy is permitted. The existing anon key is reused only by the server-held client with that additional header. The new secret does not grant access to any other database tables.

Only the production Bigin success hook launches automatic audits. Existing nudge and inactive-lead cron timings are unchanged. No new cron job is introduced.

## Automatic approval and publishing (contact-language scope)

The master switch and a separate auto-approval switch control the system. A successful Bigin push launches a signed server request to `/api/kaya-improve/review`; it acknowledges immediately and runs background review with its own execution budget. This adds function/AI usage only on events, not a timer.

The allowed automated change is an additive exact-phrase alias in `lib/kaya-improve/learning.json`. Only two meanings are supported: customer will call us, or customer requests our phone number. No free-form instructions or executable code are accepted. Conditional phrases, refusals, prices, booking actions and team callback requests are excluded. The original customer message is retained; only the existing contact-request detector consults the alias. Other business-rule issues stay `needs_admin`.

An AI proposes an alias from the quoted customer evidence. A separate AI request judges its meaning. Deterministic schema/scope checks then run, plus unchanged-input regression over locked-rule examples and every stored appointment conversation (up to a fail-closed safety limit). This does not replay every possible model response: the protected scope is exact input recognition. Correct stored bookings without flags receive only lightweight checking. Review records store redacted recent evidence.

Critical means an explicit customer-will-call phrase was followed by an assistant team-callback promise. Eligible critical proposals bypass the daily delay. Other eligible aliases batch at most once per rolling 24 hours, triggered by a Bigin push. Duplicate evidence/proposals are deduplicated; reviews and publishing use separate database leases.

Publishing requires `KAYA_GITHUB_TOKEN` configured directly in Vercel for this repository (Contents and Pull requests write, Checks/Commit statuses/Deployments read, Webhooks write). ChatGPT's GitHub connector is not a runtime credential. The generated `KAYA_GITHUB_WEBHOOK_SECRET` verifies completion events. Super Admin uses Connect / verify GitHub webhook to register the callback. Missing connection never results in a pretend successful deployment.

Before any GitHub mutation, a release record stores exact before/after content and SHA-256 hashes. The branch commit changes only the learning file and its tracked backup index. CI `verify` and Vercel preview must succeed. The branch SHA, file list and candidate hash are checked again. Main is updated by a non-forced fast-forward: a concurrent main change makes the update fail. If branch protection requires a different merge path, the release remains blocked; the application does not bypass protection. The pull request provides the audit trail. Production deployment must report success before the release is marked published.

GitHub check/status/deployment completion webhooks resume releases without polling schedules. If an event is missed, a later Bigin push or Process approved fixes now can resume processing. A stop switch is checked before publication; an in-flight GitHub write may already have completed. Turning off is not a code rollback.

Super Admin can Restore previous learning version for the currently active release. It verifies backup hashes, creates a fresh backup and tested restore commit, then follows the same CI/preview/deployment path. Old code remains until the restore deploys. It does not undo customer messages, Bigin actions, database schema or credentials. Uncertain/failed/stale releases do not silently retry publication.

Existing public WhatsApp/monitor tables are restricted to the server-header policy after this release has deployed; server clients and the inactive cron include the header. This closes direct public-key modification of user roles and customer records before connecting the publishing credential.

## Manual proposal approval and full queue processing

Super Admin can use **Approve & validate** for an unreleased, supported proposal. Approval reruns independent review, candidate validation and historical before/after replay against its source conversation. The result appears as a durable manual approval run. Findings without a concrete alias or fixed communication skill cannot be approved as code; review the conversation or implement a separately reviewed code fix.

**Process approved fixes now** creates a durable processing request and returns immediately. The publisher continues batches of up to five, waiting for each release's CI, preview and production confirmation. The recovery cron resumes the request and bypasses the normal minor daily window until the approved queue drains. Enabled and automatic approval switches, publishing connection, locked-file restrictions and all validation gates still apply. Already-present learning is recorded as a no-op rejection. Queue completion means processing finished; individual release statuses remain authoritative for deployment success.
