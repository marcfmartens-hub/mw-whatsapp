Kaya price-choice update
Based on marcfmartens-hub/mw-whatsapp main commit 4fca6a6.

Replace exactly this file in GitHub:
  app/api/webhook/route.ts

The first price reply, second price reply, third-step consignment prompt, price ban,
and the Mulkiya/specs code remain in the file. Repeated price pressure, refusal
or hesitation without an explicit team request offers a booking-or-phone-call choice.
An explicit request for a person or callback still goes straight to team handoff.
The previous 'in person' choice is recognized for conversations already in progress.

Commit the file, then verify the new Vercel production deployment is Ready.
