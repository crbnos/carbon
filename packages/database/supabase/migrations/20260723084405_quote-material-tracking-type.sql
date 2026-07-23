-- Carry the per-line tracking-type override through the quote hop.
--
-- jobMaterial got an itemTrackingType snapshot in 20260722101327, but a job
-- created FROM A QUOTE (quoteLineToJob) had nothing to read: quoteMaterial had
-- no tracking column, so the conversion fell back to the item's live value and
-- a line overridden to Non-Inventory regained ledger entries. Same nullable
-- snapshot semantics as jobMaterial: populated by get-method from the method
-- tree's materialTrackingType; NULL on legacy rows -> consumers fall back to
-- the live item, preserving today's behavior.

ALTER TABLE "quoteMaterial"
  ADD COLUMN IF NOT EXISTS "itemTrackingType" "itemTrackingType";
