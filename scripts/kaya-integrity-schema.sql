-- Additive only: existing conversations retain NULL state until a new turn.
-- This script never rewrites historical messages or CRM records.
ALTER TABLE public.mw_whatsapp ADD COLUMN IF NOT EXISTS flow_state jsonb;
COMMENT ON COLUMN public.mw_whatsapp.flow_state IS
  'Versioned conversation intent, proposed visit and callback consent; confirmed appointments remain in appointment_date/time.';
