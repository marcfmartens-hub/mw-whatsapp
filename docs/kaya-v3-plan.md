# Kaya V3 — Isolated experimental implementation

## Safety boundary
Branch: `kaya-v3-isolated`. Production WhatsApp webhook, CRM, booking APIs, and existing conversation engine are **not modified**. This prototype does **not** send messages, create bookings, or register callbacks. No customer data is passed into it.

## Objectives
1. Confirmed office inspection appointment (primary).
2. Team callback request (secondary).
3. Respect customer choice, including stop and self-contact.

## Non-negotiable rules
See `lib/kaya-v3/rules.ts`. All confirmations must be backed by a successful external transaction; a conversational reply alone is never a booking or callback confirmation. Sundays closed; no home visits; no purchase price quotes; confirmed non-GCC stops automatic booking; unknown specs may continue.

## Architecture target
1. AI intent + entity understanding.
2. Structured memory with provenance, corrections and ignored questions.
3. Central policy validator before every reply.
4. Separate transactional booking/callback adapters with idempotency and explicit success/failure.
5. Human handover and suppression of automated replies.
6. Regression suite using anonymized historical conversations.
7. Monitor test chat connected to the *actual* V3 engine, with reset, trace, and flagged anomalies.
8. Progressive activation and rollback after approval.

## Status
**Scaffold only — NOT READY FOR LIVE TESTING OR PRODUCTION.**
The current `v3Turn` is a deterministic prototype for isolated unit testing, **not** the intended AI-first V3. It intentionally has no external side effects. Before any release, replace the prototype with model-based understanding, transactional adapters, and a real independent response validator.

## Open items to verify against production
- Actual WhatsApp entrypoint and current human/AI routing.
- Authoritative booking availability, Friday hours, office location, CRM schema.
- Non-GCC Mulkiya flow and status mapping.
- CRM callback handoff confirmation and lead deduplication.
- Historical replay baseline, 100+ acceptance scenarios, regression gates.
