-- Per-location scheduling policy: when TRUE, the finite scheduler will only
-- place work where an operator is manned on the board (the any-qualified
-- floater fallback for gated ops and the machine-only fallback for ungated ops
-- are removed). Lights-out (`workCenter.alwaysOn`) stations are exempt — they
-- keep running unattended. Default FALSE preserves the existing behavior.
ALTER TABLE "location"
  ADD COLUMN IF NOT EXISTS "requiresStaffing" BOOLEAN NOT NULL DEFAULT FALSE;
