-- supplierPart."unitPrice" was added as NUMERIC(10, 2) in 20240402052512 (as "buyMethod").
-- 20260129150000 tried to widen it with ADD COLUMN IF NOT EXISTS NUMERIC(15, 5), which is a
-- no-op on any database where the column already existed, so it stayed at 2 decimal places
-- and silently rounded distributor prices (0.164 -> 0.16). Widen it for real.
ALTER TABLE "supplierPart"
ALTER COLUMN "unitPrice" TYPE NUMERIC;

-- The price-break rows are the same price on the same screen, so they can't stay
-- capped at 5 decimals while their parent is unbounded.
ALTER TABLE "supplierPartPrice"
ALTER COLUMN "unitPrice" TYPE NUMERIC;
