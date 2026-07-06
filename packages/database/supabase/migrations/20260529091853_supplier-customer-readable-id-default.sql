-- supplier.readableId and customer.readableId are filled by a BEFORE INSERT
-- trigger (see migration 20260521120000_supplier-customer-readable-id.sql),
-- so callers don't pass them. Adding DEFAULT '' makes Supabase's type
-- generator mark readableId as optional in the Insert type — the trigger
-- still overrides the empty default with the sequence value before commit.
ALTER TABLE "supplier" ALTER COLUMN "readableId" SET DEFAULT '';
ALTER TABLE "customer" ALTER COLUMN "readableId" SET DEFAULT '';
