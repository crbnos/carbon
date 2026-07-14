-- Rebrand the change-order readable-id prefix from "CO-" to "CN-" (change notice).
-- The prefix is seeded per company in the `sequence` table; companies seeded by
-- the original change-orders migration got "CO-". This flips them to "CN-" so
-- existing dev/prod companies match the new default without a rebuild.
--
-- Idempotent: only touches rows still on the old prefix. A no-op on fresh builds
-- (which now seed "CN-" directly) and on re-run.

UPDATE "sequence"
SET "prefix" = 'CN-'
WHERE "table" = 'changeOrder'
  AND "prefix" = 'CO-';
