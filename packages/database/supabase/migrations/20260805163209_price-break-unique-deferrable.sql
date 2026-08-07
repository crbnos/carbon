-- Make the price-break (parent, quantity) UNIQUE deferrable so upsertCustomerItem-
-- PriceOverride can shift a quantity ladder one rung at a time without tripping a
-- transient duplicate. INITIALLY IMMEDIATE keeps default checking for other writers;
-- the break sync opts in with SET CONSTRAINTS ... DEFERRED to move the check to commit.

ALTER TABLE "customerItemPriceOverrideBreak"
  DROP CONSTRAINT IF EXISTS "customerItemPriceOverrideBreak_override_qty_uq";

ALTER TABLE "customerItemPriceOverrideBreak"
  ADD CONSTRAINT "customerItemPriceOverrideBreak_override_qty_uq"
  UNIQUE ("customerItemPriceOverrideId", "quantity")
  DEFERRABLE INITIALLY IMMEDIATE;
