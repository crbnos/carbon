-- Add an explicit price provenance flag to quoteLinePrice.
--
-- 'system' = Carbon computed this price (cost rollup × markups, price
--            resolution). Recalculations keep repricing these rows.
-- 'manual' = a person or an external system (UI price edit, Paperless Parts
--            import) stated this price. No recalculation may change it.
--
-- Replaces the ambiguous heuristic (empty categoryMarkups + unitPrice > 0)
-- which could not distinguish a user-typed price from a system-computed one.

ALTER TABLE "quoteLinePrice"
  ADD COLUMN "priceSource" TEXT NOT NULL DEFAULT 'system';

-- NOT VALID skips the full-table validation scan under the ACCESS EXCLUSIVE
-- lock; the constraint is validated explicitly after the backfill under a
-- weaker lock.
ALTER TABLE "quoteLinePrice"
  ADD CONSTRAINT "quoteLinePrice_priceSource_check"
  CHECK ("priceSource" IN ('system', 'manual')) NOT VALID;

-- Backfill: err on the side of never overwriting a price. A frozen price is
-- visible and recoverable (edit a markup to re-enable cost tracking); a
-- silently overwritten customer-facing quote price is not. Any priced row
-- without a positive per-category markup is treated as manually priced.
UPDATE "quoteLinePrice"
SET "priceSource" = 'manual'
WHERE "unitPrice" > 0
  AND (
    "categoryMarkups" IS NULL
    OR "categoryMarkups" = '{}'::jsonb
    OR NOT EXISTS (
      SELECT 1
      FROM jsonb_each_text("categoryMarkups") AS kv
      WHERE kv.value::numeric > 0
    )
  );

ALTER TABLE "quoteLinePrice"
  VALIDATE CONSTRAINT "quoteLinePrice_priceSource_check";
