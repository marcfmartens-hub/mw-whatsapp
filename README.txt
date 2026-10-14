Kaya specs update — based on marcfmartens-hub/mw-whatsapp main at 9d5cdc9f07a7aad434bcdeb53472ef5033b5e67b

Replace these files in your GitHub repository, keeping the same paths:
  app/api/webhook/route.ts
  lib/claude.ts
  lib/specs.ts  (new file)

This package contains the specs/Mulkiya rules only. It does not change the price callback wording, booking-time fallback, or booking-change behavior.

After uploading all three files, commit them together. Vercel can then deploy that commit through your existing GitHub integration. Confirm Vercel reports a successful deployment before relying on the new behavior.
