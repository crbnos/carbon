-- Separate shipping revenue and retain exact settlement funding principal.

ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "salesShippingRevenueAccount" TEXT;
ALTER TABLE "invoiceSettlement"
  ADD COLUMN IF NOT EXISTS "sourcePaymentId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceAmount" NUMERIC;
ALTER TABLE "invoiceSettlement"
  ALTER COLUMN "fxGainLossAmount" DROP EXPRESSION IF EXISTS;
ALTER TABLE "invoiceSettlement"
  ALTER COLUMN "fxGainLossAmount" SET DEFAULT 0;
-- The dropped expression could never yield NULL (all three of its inputs are
-- NOT NULL), so the column stays NOT NULL now that writers supply it. Without
-- this the generated Insert type admits null, and every reader sums the column
-- bare -- SUM("appliedAmount" + "fxGainLossAmount") -- so one null row would
-- erase that settlement's principal from the tie-outs and the aging reports.
DO $fx_gain_loss_not_null$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = '"invoiceSettlement"'::regclass
      AND attname = 'fxGainLossAmount'
      AND attnum > 0 AND NOT attisdropped AND NOT attnotnull
  ) THEN
    UPDATE "invoiceSettlement" SET "fxGainLossAmount" = 0
      WHERE "fxGainLossAmount" IS NULL;
    ALTER TABLE "invoiceSettlement" ALTER COLUMN "fxGainLossAmount" SET NOT NULL;
  END IF;
END;
$fx_gain_loss_not_null$;
ALTER TABLE "invoiceSettlement"
  DROP CONSTRAINT IF EXISTS "invoiceSettlement_anyComponent_check";
ALTER TABLE "invoiceSettlement"
  ADD CONSTRAINT "invoiceSettlement_anyComponent_check" CHECK (
    "appliedAmount" + "discountAmount" + "writeOffAmount" > 0
    OR COALESCE("sourceAmount", 0) > 0
  );

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"accountDefault"'::regclass AND conname='accountDefault_salesShippingRevenueAccount_fkey') THEN
    ALTER TABLE "accountDefault" ADD CONSTRAINT "accountDefault_salesShippingRevenueAccount_fkey"
      FOREIGN KEY ("salesShippingRevenueAccount") REFERENCES "account"(id)
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"payment"'::regclass AND conname='payment_id_companyId_key') THEN
    ALTER TABLE "payment" ADD CONSTRAINT "payment_id_companyId_key" UNIQUE (id, "companyId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"invoiceSettlement"'::regclass AND conname='invoiceSettlement_sourcePaymentId_companyId_fkey') THEN
    ALTER TABLE "invoiceSettlement" ADD CONSTRAINT "invoiceSettlement_sourcePaymentId_companyId_fkey"
      FOREIGN KEY ("sourcePaymentId", "companyId") REFERENCES "payment"(id, "companyId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"invoiceSettlement"'::regclass AND conname='invoiceSettlement_sourcePaymentId_check') THEN
    ALTER TABLE "invoiceSettlement" ADD CONSTRAINT "invoiceSettlement_sourcePaymentId_check"
      CHECK ("sourcePaymentId" IS NULL OR (
        "paymentId" IS NOT NULL AND "memoId" IS NULL AND "sourcePaymentId" <> "paymentId"
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"invoiceSettlement"'::regclass AND conname='invoiceSettlement_sourceAmount_check') THEN
    ALTER TABLE "invoiceSettlement" ADD CONSTRAINT "invoiceSettlement_sourceAmount_check"
      CHECK ("sourceAmount" IS NULL OR (
        "sourceAmount" >= 0 AND "sourceAmount" NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
      ));
  END IF;
END;
$constraints$;

CREATE INDEX IF NOT EXISTS "accountDefault_salesShippingRevenueAccount_idx"
  ON "accountDefault"("salesShippingRevenueAccount");
CREATE INDEX IF NOT EXISTS "invoiceSettlement_sourcePaymentId_companyId_idx"
  ON "invoiceSettlement"("sourcePaymentId", "companyId") WHERE "sourcePaymentId" IS NOT NULL;

-- Serialize chart/default resolution while choosing unused numbers and IDs.
LOCK TABLE "account", "accountDefault" IN SHARE ROW EXCLUSIVE MODE;

DO $existing_defaults$
DECLARE bad text;
BEGIN
  SELECT string_agg(ad."companyId", ', ' ORDER BY ad."companyId") INTO bad
  FROM "accountDefault" ad
  JOIN "company" c ON c.id=ad."companyId"
  LEFT JOIN "account" a ON a.id=ad."salesShippingRevenueAccount"
  WHERE ad."salesShippingRevenueAccount" IS NOT NULL AND (
    a.id IS NULL OR a."companyGroupId" IS DISTINCT FROM c."companyGroupId"
    OR a.active IS DISTINCT FROM true OR a."isGroup" IS DISTINCT FROM false
    OR a.class IS DISTINCT FROM 'Revenue' OR a."incomeBalance" IS DISTINCT FROM 'Income Statement'
    OR a.id=ad."salesAccount"
  );
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Invalid shipping defaults for companies: %', bad; END IF;
END;
$existing_defaults$;

CREATE TEMP TABLE accounting_shipping_resolution ON COMMIT DROP AS
WITH groups AS (
  SELECT DISTINCT c."companyGroupId"
  FROM "company" c JOIN "accountDefault" ad ON ad."companyId"=c.id
  WHERE ad."salesShippingRevenueAccount" IS NULL
), sales_parents AS (
  SELECT c."companyGroupId", min(p.id) AS parent_id, count(DISTINCT p.id) AS parent_count
  FROM "company" c
  JOIN "accountDefault" ad ON ad."companyId"=c.id
  JOIN "account" sales ON sales.id=ad."salesAccount" AND sales."companyGroupId"=c."companyGroupId"
  JOIN "account" p ON p.id=sales."parentId" AND p."companyGroupId"=c."companyGroupId"
  WHERE p.active AND p."isGroup" AND p.class='Revenue'
    AND p."incomeBalance"='Income Statement' AND p."accountType"='Income'
  GROUP BY c."companyGroupId"
)
SELECT g."companyGroupId",
  CASE WHEN named_parent.id IS NOT NULL THEN named_parent.id
    WHEN sp.parent_count=1 THEN sp.parent_id END AS parent_id,
  named_parent.id IS NOT NULL AND (
    named_parent.active IS DISTINCT FROM true OR named_parent.class IS DISTINCT FROM 'Revenue'
    OR named_parent."incomeBalance" IS DISTINCT FROM 'Income Statement'
    OR named_parent."accountType" IS DISTINCT FROM 'Income'
  ) AS invalid_named_parent,
  existing.id AS existing_id,
  COALESCE(existing.id, id('acct')) AS account_id,
  COALESCE(existing.number, free_number.number) AS account_number
FROM groups g
LEFT JOIN "account" named_parent ON named_parent."companyGroupId"=g."companyGroupId"
  AND named_parent.name='Revenue' AND named_parent."isGroup"=true
LEFT JOIN sales_parents sp ON sp."companyGroupId"=g."companyGroupId"
LEFT JOIN "account" existing ON existing."companyGroupId"=g."companyGroupId"
  AND existing.name='Shipping Revenue' AND existing."isGroup"=false
LEFT JOIN LATERAL (
  -- Starts at 4050: 4040 is reserved for "Customer Payment Discounts", which
  -- the later 20260909014032 migration renumbers 7030 into. That renumber is
  -- guarded by NOT EXISTS, so claiming 4040 here would silently suppress it.
  SELECT n::text AS number FROM generate_series(4050,4990,10) n
  WHERE NOT EXISTS (SELECT 1 FROM "account" a
    WHERE a."companyGroupId"=g."companyGroupId" AND a.number=n::text)
  ORDER BY n LIMIT 1
) free_number ON true;

DO $resolved$
DECLARE bad text;
BEGIN
  SELECT string_agg(r."companyGroupId", ', ' ORDER BY r."companyGroupId") INTO bad
  FROM accounting_shipping_resolution r
  LEFT JOIN "account" a ON a.id=r.existing_id
  WHERE r.parent_id IS NULL OR r.invalid_named_parent IS TRUE
    OR (r.existing_id IS NULL AND r.account_number IS NULL)
    OR EXISTS (
      SELECT 1 FROM "account" conflicting
      WHERE conflicting."companyGroupId"=r."companyGroupId"
        AND conflicting.name='Shipping Revenue' AND conflicting."isGroup" IS DISTINCT FROM false
    )
    OR EXISTS (
      SELECT 1 FROM "company" c JOIN "accountDefault" ad ON ad."companyId"=c.id
      WHERE c."companyGroupId"=r."companyGroupId"
        AND ad."salesShippingRevenueAccount" IS NULL AND ad."salesAccount"=r.account_id
    )
    OR (r.existing_id IS NOT NULL AND (
      a.active IS DISTINCT FROM true OR a.class IS DISTINCT FROM 'Revenue'
      OR a."accountType" IS DISTINCT FROM 'Income' OR a."incomeBalance" IS DISTINCT FROM 'Income Statement'
      OR a."consolidatedRate" IS DISTINCT FROM 'Average' OR a."parentId" IS DISTINCT FROM r.parent_id
    ));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot resolve Shipping Revenue parent/account/number for groups: %', bad;
  END IF;
END;
$resolved$;

INSERT INTO "account"(id,number,name,class,"accountType","incomeBalance","consolidatedRate",
  "parentId","isGroup",active,"isSystem","companyGroupId","createdBy")
SELECT account_id,account_number,'Shipping Revenue','Revenue','Income','Income Statement','Average',
  parent_id,false,true,false,"companyGroupId",'system'
FROM accounting_shipping_resolution WHERE existing_id IS NULL;

UPDATE "accountDefault" ad SET "salesShippingRevenueAccount"=r.account_id,
  "updatedBy"='system'
FROM "company" c JOIN accounting_shipping_resolution r ON r."companyGroupId"=c."companyGroupId"
WHERE ad."companyId"=c.id AND ad."salesShippingRevenueAccount" IS NULL;

COMMENT ON COLUMN "accountDefault"."salesShippingRevenueAccount" IS 'Revenue account for shipping charged to customers; account belongs to the company group.';
COMMENT ON COLUMN "invoiceSettlement"."sourcePaymentId" IS 'Prior posted payment supplying on-account credit; paymentId remains the applying/void owner. NULL means current payment cash.';
COMMENT ON COLUMN "invoiceSettlement"."sourceAmount" IS 'Principal consumed in the funding source document currency, stored independently of target-base appliedAmount.';
COMMENT ON COLUMN "invoiceSettlement"."appliedAmount" IS 'Target-document principal relieved in company base currency.';
COMMENT ON COLUMN "invoiceSettlement"."discountAmount" IS 'Target-document discount relief in company base currency.';
COMMENT ON COLUMN "invoiceSettlement"."writeOffAmount" IS 'Target-document write-off relief in company base currency.';
COMMENT ON COLUMN "invoiceSettlement"."fxGainLossAmount" IS 'Server-calculated posting snapshot in company base currency: positive gain, negative loss.';
COMMENT ON COLUMN "payment"."totalAmount" IS 'Gross cash amount in payment currency; divide by foreign-per-base exchangeRate for company base.';
COMMENT ON COLUMN "memo"."amount" IS 'Memo amount in memo currency; divide by foreign-per-base exchangeRate for company base.';
NOTIFY pgrst, 'reload schema';
