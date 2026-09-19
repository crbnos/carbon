-- Reconcile Ramp card-transaction storage on one forward migration version.
--
-- Three branch-only predecessors are tombstoned. This file therefore handles
-- both clean databases and databases where any/all of those files were already
-- applied. Each top-level statement is retry-safe because the deploy runner may
-- retry after a previously committed statement.

-- Registry and enums ---------------------------------------------------------

INSERT INTO "integration" (id, jsonschema)
VALUES ('ramp', '{"type":"object","properties":{}}'::json)
ON CONFLICT (id) DO NOTHING;

ALTER TYPE "journalEntrySourceType"
  ADD VALUE IF NOT EXISTS 'Card Transaction';
ALTER TYPE "journalLineDocumentType"
  ADD VALUE IF NOT EXISTS 'Card Transaction';

DO $$
BEGIN
  IF to_regtype('public."cardTransactionType"') IS NULL THEN
    CREATE TYPE public."cardTransactionType" AS ENUM
      ('Charge', 'Credit', 'Payment', 'Cashback', 'Repayment');
  END IF;
  IF to_regtype('public."cardTransactionStatus"') IS NULL THEN
    CREATE TYPE public."cardTransactionStatus" AS ENUM ('Draft', 'Posted', 'Voided');
  END IF;
END;
$$;

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(required.label, ', ' ORDER BY required.ordinality)
    INTO missing
  FROM unnest(ARRAY['Charge', 'Credit', 'Payment', 'Cashback', 'Repayment'])
       WITH ORDINALITY AS required(label, ordinality)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'cardTransactionType'
      AND t.typnamespace = 'public'::regnamespace
      AND e.enumlabel = required.label
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'cardTransactionType is missing required values: %', missing;
  END IF;

  SELECT string_agg(required.label, ', ' ORDER BY required.ordinality)
    INTO missing
  FROM unnest(ARRAY['Draft', 'Posted', 'Voided'])
       WITH ORDINALITY AS required(label, ordinality)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'cardTransactionStatus'
      AND t.typnamespace = 'public'::regnamespace
      AND e.enumlabel = required.label
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'cardTransactionStatus is missing required values: %', missing;
  END IF;
END;
$$;

-- Composite FK targets -------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"supplier"'::regclass
      AND conname = 'supplier_id_companyId_key'
  ) THEN
    ALTER TABLE "supplier"
      ADD CONSTRAINT "supplier_id_companyId_key" UNIQUE (id, "companyId");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"costCenter"'::regclass
      AND conname = 'costCenter_id_companyId_key'
  ) THEN
    ALTER TABLE "costCenter"
      ADD CONSTRAINT "costCenter_id_companyId_key" UNIQUE (id, "companyId");
  END IF;
END;
$$;

-- Clean-database definitions -------------------------------------------------

CREATE TABLE IF NOT EXISTS "cardTransaction" (
  id TEXT NOT NULL DEFAULT id(),
  "companyId" TEXT NOT NULL,
  "cardTransactionId" TEXT NOT NULL,
  type "cardTransactionType" NOT NULL DEFAULT 'Charge',
  status "cardTransactionStatus" NOT NULL DEFAULT 'Draft',
  integration TEXT NOT NULL DEFAULT 'ramp',
  "cardAccountId" TEXT NOT NULL REFERENCES "account"(id),
  "offsetAccountId" TEXT REFERENCES "account"(id),
  "supplierId" TEXT,
  "merchantName" TEXT,
  "cardHolderName" TEXT,
  "cardLast4" TEXT,
  memo TEXT,
  "transactionDate" DATE NOT NULL,
  "postingDate" DATE,
  "currencyCode" TEXT NOT NULL REFERENCES "currencyCode"(code),
  "exchangeRate" NUMERIC NOT NULL DEFAULT 1 CHECK ("exchangeRate" > 0),
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  "journalId" TEXT REFERENCES "journal"(id),
  "postedAt" TIMESTAMP WITH TIME ZONE,
  "postedBy" TEXT REFERENCES "user"(id),
  "voidedAt" TIMESTAMP WITH TIME ZONE,
  "voidedBy" TEXT REFERENCES "user"(id),
  "createdBy" TEXT NOT NULL REFERENCES "user"(id),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"(id),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "cardTransaction_pkey" PRIMARY KEY (id, "companyId"),
  CONSTRAINT "cardTransaction_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"(id) ON DELETE CASCADE,
  CONSTRAINT "cardTransaction_supplierId_fkey"
    FOREIGN KEY ("supplierId", "companyId")
    REFERENCES "supplier"(id, "companyId")
    ON UPDATE CASCADE ON DELETE SET NULL ("supplierId"),
  CONSTRAINT "cardTransaction_cardTransactionId_companyId_key"
    UNIQUE ("cardTransactionId", "companyId"),
  CONSTRAINT "cardTransaction_offset_check" CHECK (
    type IN ('Charge', 'Credit') OR "offsetAccountId" IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS "cardTransactionLine" (
  id TEXT NOT NULL DEFAULT id(),
  "companyId" TEXT NOT NULL,
  "cardTransactionId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL REFERENCES "account"(id),
  "costCenterId" TEXT,
  description TEXT,
  amount NUMERIC NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL REFERENCES "user"(id),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"(id),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,

  CONSTRAINT "cardTransactionLine_pkey" PRIMARY KEY (id, "companyId"),
  CONSTRAINT "cardTransactionLine_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"(id) ON DELETE CASCADE,
  CONSTRAINT "cardTransactionLine_cardTransactionId_fkey"
    FOREIGN KEY ("cardTransactionId", "companyId")
    REFERENCES "cardTransaction"(id, "companyId") ON DELETE CASCADE,
  CONSTRAINT "cardTransactionLine_costCenterId_fkey"
    FOREIGN KEY ("costCenterId", "companyId")
    REFERENCES "costCenter"(id, "companyId")
    ON UPDATE CASCADE ON DELETE SET NULL ("costCenterId")
);

-- A database that applied the original table migration may not have reached
-- the later supplier migration before this file is retried.
ALTER TABLE "cardTransaction"
  ADD COLUMN IF NOT EXISTS "supplierId" TEXT;

-- Existing-database convergence ---------------------------------------------
-- One DO statement owns the validation and constraint replacement so there is
-- no committed interval without tenant FKs. Locks stop concurrent writes from
-- entering between the diagnostics and the new constraints.

DO $reconcile$
DECLARE
  offending text;
BEGIN
  LOCK TABLE "cardTransaction", "cardTransactionLine", "company",
    "account", "supplier", "costCenter" IN SHARE ROW EXCLUSIVE MODE;

  SELECT string_agg(format('%s/%s -> %s (companies: %s)',
                           x.id, x.company_id, x.parent_id,
                           x.parent_company_ids), ', ')
    INTO offending
  FROM (
    SELECT l.id, l."companyId" AS company_id,
           l."cardTransactionId" AS parent_id,
           COALESCE((
             SELECT string_agg(h."companyId", '/' ORDER BY h."companyId")
             FROM "cardTransaction" h
             WHERE h.id = l."cardTransactionId"
           ), 'none') AS parent_company_ids
    FROM "cardTransactionLine" l
    WHERE NOT EXISTS (
      SELECT 1
      FROM "cardTransaction" h
      WHERE h.id = l."cardTransactionId"
        AND h."companyId" = l."companyId"
    )
    ORDER BY l.id, l."companyId"
    LIMIT 25
  ) x;
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'cardTransactionLine rows lack a same-company card transaction parent: %',
      offending;
  END IF;

  SELECT string_agg(format('%s/%s -> %s (companies: %s)',
                           x.id, x.company_id, x.supplier_id,
                           x.supplier_company_ids), ', ')
    INTO offending
  FROM (
    SELECT h.id, h."companyId" AS company_id, h."supplierId" AS supplier_id,
           COALESCE((
             SELECT string_agg(s."companyId", '/' ORDER BY s."companyId")
             FROM "supplier" s
             WHERE s.id = h."supplierId"
           ), 'none') AS supplier_company_ids
    FROM "cardTransaction" h
    WHERE h."supplierId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "supplier" s
        WHERE s.id = h."supplierId"
          AND s."companyId" = h."companyId"
      )
    ORDER BY h.id, h."companyId"
    LIMIT 25
  ) x;
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'cardTransaction rows lack a same-company supplier: %',
      offending;
  END IF;

  SELECT string_agg(format('%s/%s -> %s (companies: %s)',
                           x.id, x.company_id, x.cost_center_id,
                           x.cost_center_company_ids), ', ')
    INTO offending
  FROM (
    SELECT l.id, l."companyId" AS company_id,
           l."costCenterId" AS cost_center_id,
           COALESCE((
             SELECT string_agg(cc."companyId", '/' ORDER BY cc."companyId")
             FROM "costCenter" cc
             WHERE cc.id = l."costCenterId"
           ), 'none') AS cost_center_company_ids
    FROM "cardTransactionLine" l
    WHERE l."costCenterId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "costCenter" cc
        WHERE cc.id = l."costCenterId"
          AND cc."companyId" = l."companyId"
      )
    ORDER BY l.id, l."companyId"
    LIMIT 25
  ) x;
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'cardTransactionLine rows lack a same-company cost center: %',
      offending;
  END IF;

  SELECT string_agg(format('%s/%s (%s)', x.id, x.company_id, x.bad_accounts), ', ')
    INTO offending
  FROM (
    SELECT h.id, h."companyId" AS company_id,
      concat_ws(', ',
        CASE WHEN card.id IS NULL OR card."companyGroupId" IS DISTINCT FROM c."companyGroupId"
          THEN 'cardAccountId=' || h."cardAccountId" END,
        CASE WHEN h."offsetAccountId" IS NOT NULL
               AND (offset_account.id IS NULL OR offset_account."companyGroupId" IS DISTINCT FROM c."companyGroupId")
          THEN 'offsetAccountId=' || h."offsetAccountId" END
      ) AS bad_accounts
    FROM "cardTransaction" h
    JOIN "company" c ON c.id = h."companyId"
    LEFT JOIN "account" card ON card.id = h."cardAccountId"
    LEFT JOIN "account" offset_account ON offset_account.id = h."offsetAccountId"
    WHERE card.id IS NULL
       OR card."companyGroupId" IS DISTINCT FROM c."companyGroupId"
       OR (h."offsetAccountId" IS NOT NULL AND (
            offset_account.id IS NULL
            OR offset_account."companyGroupId" IS DISTINCT FROM c."companyGroupId"
          ))
    ORDER BY h.id, h."companyId"
    LIMIT 25
  ) x;
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'cardTransaction rows reference accounts outside their company group: %',
      offending;
  END IF;

  SELECT string_agg(format('%s/%s -> %s', x.id, x.company_id, x.account_id), ', ')
    INTO offending
  FROM (
    SELECT l.id, l."companyId" AS company_id, l."accountId" AS account_id
    FROM "cardTransactionLine" l
    JOIN "company" c ON c.id = l."companyId"
    LEFT JOIN "account" a ON a.id = l."accountId"
    WHERE a.id IS NULL
       OR a."companyGroupId" IS DISTINCT FROM c."companyGroupId"
    ORDER BY l.id, l."companyId"
    LIMIT 25
  ) x;
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'cardTransactionLine rows reference accounts outside their company group: %',
      offending;
  END IF;

  ALTER TABLE "cardTransactionLine"
    DROP CONSTRAINT IF EXISTS "cardTransactionLine_cardTransactionId_fkey",
    DROP CONSTRAINT IF EXISTS "cardTransactionLine_costCenterId_fkey";
  ALTER TABLE "cardTransaction"
    DROP CONSTRAINT IF EXISTS "cardTransaction_supplierId_fkey";

  ALTER TABLE "cardTransactionLine"
    DROP CONSTRAINT IF EXISTS "cardTransactionLine_pkey",
    ADD CONSTRAINT "cardTransactionLine_pkey" PRIMARY KEY (id, "companyId");
  ALTER TABLE "cardTransaction"
    DROP CONSTRAINT IF EXISTS "cardTransaction_pkey",
    ADD CONSTRAINT "cardTransaction_pkey" PRIMARY KEY (id, "companyId");

  ALTER TABLE "cardTransaction"
    ADD CONSTRAINT "cardTransaction_supplierId_fkey"
      FOREIGN KEY ("supplierId", "companyId")
      REFERENCES "supplier"(id, "companyId")
      ON UPDATE CASCADE ON DELETE SET NULL ("supplierId");
  ALTER TABLE "cardTransactionLine"
    ADD CONSTRAINT "cardTransactionLine_cardTransactionId_fkey"
      FOREIGN KEY ("cardTransactionId", "companyId")
      REFERENCES "cardTransaction"(id, "companyId") ON DELETE CASCADE,
    ADD CONSTRAINT "cardTransactionLine_costCenterId_fkey"
      FOREIGN KEY ("costCenterId", "companyId")
      REFERENCES "costCenter"(id, "companyId")
      ON UPDATE CASCADE ON DELETE SET NULL ("costCenterId");

  ALTER TABLE "cardTransaction" ALTER COLUMN id SET DEFAULT id();
  ALTER TABLE "cardTransactionLine" ALTER COLUMN id SET DEFAULT id();
END;
$reconcile$;

-- Supporting indexes ---------------------------------------------------------

CREATE INDEX IF NOT EXISTS "cardTransaction_companyId_idx"
  ON "cardTransaction" ("companyId");
CREATE INDEX IF NOT EXISTS "cardTransaction_companyId_status_idx"
  ON "cardTransaction" ("companyId", status);
CREATE INDEX IF NOT EXISTS "cardTransaction_companyId_transactionDate_idx"
  ON "cardTransaction" ("companyId", "transactionDate");
CREATE INDEX IF NOT EXISTS "cardTransaction_companyId_supplierId_idx"
  ON "cardTransaction" ("companyId", "supplierId");
CREATE INDEX IF NOT EXISTS "cardTransaction_cardAccountId_idx"
  ON "cardTransaction" ("cardAccountId");
CREATE INDEX IF NOT EXISTS "cardTransaction_offsetAccountId_idx"
  ON "cardTransaction" ("offsetAccountId");
CREATE INDEX IF NOT EXISTS "cardTransaction_currencyCode_idx"
  ON "cardTransaction" ("currencyCode");
CREATE INDEX IF NOT EXISTS "cardTransaction_journalId_idx"
  ON "cardTransaction" ("journalId");
CREATE INDEX IF NOT EXISTS "cardTransaction_createdBy_idx"
  ON "cardTransaction" ("createdBy");
CREATE INDEX IF NOT EXISTS "cardTransaction_updatedBy_idx"
  ON "cardTransaction" ("updatedBy");
CREATE INDEX IF NOT EXISTS "cardTransaction_postedBy_idx"
  ON "cardTransaction" ("postedBy");
CREATE INDEX IF NOT EXISTS "cardTransaction_voidedBy_idx"
  ON "cardTransaction" ("voidedBy");

CREATE INDEX IF NOT EXISTS "cardTransactionLine_companyId_idx"
  ON "cardTransactionLine" ("companyId");
CREATE INDEX IF NOT EXISTS "cardTransactionLine_cardTransactionId_companyId_idx"
  ON "cardTransactionLine" ("cardTransactionId", "companyId");
CREATE INDEX IF NOT EXISTS "cardTransactionLine_accountId_idx"
  ON "cardTransactionLine" ("accountId");
CREATE INDEX IF NOT EXISTS "cardTransactionLine_costCenterId_companyId_idx"
  ON "cardTransactionLine" ("costCenterId", "companyId");
CREATE INDEX IF NOT EXISTS "cardTransactionLine_createdBy_idx"
  ON "cardTransactionLine" ("createdBy");
CREATE INDEX IF NOT EXISTS "cardTransactionLine_updatedBy_idx"
  ON "cardTransactionLine" ("updatedBy");

-- Company-group account integrity -------------------------------------------

CREATE OR REPLACE FUNCTION public.check_card_transaction_account_company_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  company_group_id text;
BEGIN
  SELECT c."companyGroupId" INTO company_group_id
  FROM "company" c
  WHERE c.id = NEW."companyId";

  IF company_group_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM "account" a
       WHERE a.id = NEW."cardAccountId"
         AND a."companyGroupId" = company_group_id
     )
     OR (
       NEW."offsetAccountId" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM "account" a
         WHERE a.id = NEW."offsetAccountId"
           AND a."companyGroupId" = company_group_id
       )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'cardTransaction_account_companyGroup_check',
      MESSAGE = format(
        'Card transaction %s/%s references an account outside its company group',
        NEW.id,
        NEW."companyId"
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "cardTransaction_account_companyGroup_guard"
  ON "cardTransaction";
CREATE TRIGGER "cardTransaction_account_companyGroup_guard"
  BEFORE INSERT OR UPDATE OF "companyId", "cardAccountId", "offsetAccountId"
  ON "cardTransaction"
  FOR EACH ROW
  EXECUTE FUNCTION public.check_card_transaction_account_company_group();

CREATE OR REPLACE FUNCTION public.check_card_transaction_line_account_company_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "company" c
    JOIN "account" a ON a."companyGroupId" = c."companyGroupId"
    WHERE c.id = NEW."companyId"
      AND a.id = NEW."accountId"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'cardTransactionLine_account_companyGroup_check',
      MESSAGE = format(
        'Card transaction line %s/%s references an account outside its company group',
        NEW.id,
        NEW."companyId"
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "cardTransactionLine_account_companyGroup_guard"
  ON "cardTransactionLine";
CREATE TRIGGER "cardTransactionLine_account_companyGroup_guard"
  BEFORE INSERT OR UPDATE OF "companyId", "accountId"
  ON "cardTransactionLine"
  FOR EACH ROW
  EXECUTE FUNCTION public.check_card_transaction_line_account_company_group();

-- Draft-only mutation and lifecycle state machine ---------------------------

CREATE OR REPLACE FUNCTION public.check_card_transaction_draft_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'Draft' THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = format(
          'Card transaction %s/%s must be created in Draft status',
          NEW.id,
          NEW."companyId"
        );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'Draft' THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = format(
          'Card transaction %s/%s is %s and cannot be deleted',
          OLD.id,
          OLD."companyId",
          OLD.status
        );
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'Draft' AND NEW.status = 'Draft' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'Draft' AND NEW.status = 'Posted' THEN
    IF (to_jsonb(NEW) - ARRAY[
          'status', 'journalId', 'postingDate', 'postedAt', 'postedBy',
          'updatedAt', 'updatedBy'
        ]) =
       (to_jsonb(OLD) - ARRAY[
          'status', 'journalId', 'postingDate', 'postedAt', 'postedBy',
          'updatedAt', 'updatedBy'
        ]) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format(
        'Card transaction %s/%s content cannot change while posting',
        OLD.id,
        OLD."companyId"
      );
  END IF;

  IF OLD.status = 'Posted' AND NEW.status = 'Voided' THEN
    IF (to_jsonb(NEW) - ARRAY[
          'status', 'voidedAt', 'voidedBy', 'updatedAt', 'updatedBy'
        ]) =
       (to_jsonb(OLD) - ARRAY[
          'status', 'voidedAt', 'voidedBy', 'updatedAt', 'updatedBy'
        ]) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format(
        'Card transaction %s/%s content cannot change while voiding',
        OLD.id,
        OLD."companyId"
      );
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = format(
      'Card transaction %s/%s cannot transition from %s to %s',
      OLD.id,
      OLD."companyId",
      OLD.status,
      NEW.status
    );
END;
$$;

DROP TRIGGER IF EXISTS "cardTransaction_draft_guard" ON "cardTransaction";
CREATE TRIGGER "cardTransaction_draft_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "cardTransaction"
  FOR EACH ROW
  EXECUTE FUNCTION public.check_card_transaction_draft_mutation();

CREATE OR REPLACE FUNCTION public.lock_card_transaction_line_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  parent_id text;
  parent_company_id text;
  parent_status "cardTransactionStatus";
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW."cardTransactionId" IS DISTINCT FROM OLD."cardTransactionId"
       OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format(
        'Card transaction line %s/%s cannot be moved to another parent',
        OLD.id,
        OLD."companyId"
      );
  END IF;

  IF TG_OP = 'DELETE' THEN
    parent_id := OLD."cardTransactionId";
    parent_company_id := OLD."companyId";
  ELSE
    parent_id := NEW."cardTransactionId";
    parent_company_id := NEW."companyId";
  END IF;

  SELECT h.status INTO parent_status
  FROM "cardTransaction" h
  WHERE h.id = parent_id
    AND h."companyId" = parent_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- The parent row is no longer visible while its own Draft-only DELETE is
    -- cascading. The parent guard already authorized that delete.
    IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      CONSTRAINT = 'cardTransactionLine_cardTransactionId_fkey',
      MESSAGE = format(
        'Card transaction line parent %s/%s does not exist',
        parent_id,
        parent_company_id
      );
  END IF;

  IF parent_status <> 'Draft' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = format(
        'Card transaction %s/%s is %s; its lines are immutable',
        parent_id,
        parent_company_id,
        parent_status
      );
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "cardTransactionLine_draft_guard"
  ON "cardTransactionLine";
CREATE TRIGGER "cardTransactionLine_draft_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "cardTransactionLine"
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_card_transaction_line_parent();

-- RLS mirrors the trigger invariants for authenticated clients. Service-role
-- posting still passes through the database triggers above.

ALTER TABLE "public"."cardTransaction" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."cardTransaction";
CREATE POLICY "SELECT" ON "public"."cardTransaction"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."cardTransaction";
CREATE POLICY "INSERT" ON "public"."cardTransaction"
FOR INSERT WITH CHECK (
  status = 'Draft'
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_create'))::text[]
  )
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."cardTransaction";
CREATE POLICY "UPDATE" ON "public"."cardTransaction"
FOR UPDATE USING (
  status = 'Draft'
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
) WITH CHECK (
  status = 'Draft'
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
);
DROP POLICY IF EXISTS "DELETE" ON "public"."cardTransaction";
CREATE POLICY "DELETE" ON "public"."cardTransaction"
FOR DELETE USING (
  status = 'Draft'
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_delete'))::text[]
  )
);

ALTER TABLE "public"."cardTransactionLine" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."cardTransactionLine";
CREATE POLICY "SELECT" ON "public"."cardTransactionLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."cardTransactionLine";
CREATE POLICY "INSERT" ON "public"."cardTransactionLine"
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM "cardTransaction" h
    WHERE h.id = "cardTransactionLine"."cardTransactionId"
      AND h."companyId" = "cardTransactionLine"."companyId"
      AND h.status = 'Draft'
  )
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_create'))::text[]
  )
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."cardTransactionLine";
CREATE POLICY "UPDATE" ON "public"."cardTransactionLine"
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM "cardTransaction" h
    WHERE h.id = "cardTransactionLine"."cardTransactionId"
      AND h."companyId" = "cardTransactionLine"."companyId"
      AND h.status = 'Draft'
  )
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM "cardTransaction" h
    WHERE h.id = "cardTransactionLine"."cardTransactionId"
      AND h."companyId" = "cardTransactionLine"."companyId"
      AND h.status = 'Draft'
  )
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
);
DROP POLICY IF EXISTS "DELETE" ON "public"."cardTransactionLine";
CREATE POLICY "DELETE" ON "public"."cardTransactionLine"
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM "cardTransaction" h
    WHERE h.id = "cardTransactionLine"."cardTransactionId"
      AND h."companyId" = "cardTransactionLine"."companyId"
      AND h.status = 'Draft'
  )
  AND "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_delete'))::text[]
  )
);

-- Existing companies need the document sequence; new-company seed data owns
-- the other population path.
INSERT INTO "sequence" (
  "table", name, prefix, suffix, next, size, step, "companyId"
)
SELECT 'cardTransaction', 'Card Transaction',
       'CARD-%{yyyy}-%{mm}-', NULL, 0, 6, 1, c.id
FROM "company" c
ON CONFLICT DO NOTHING;

-- Re-running the helper drops/recreates only its named event-system triggers,
-- so it converges both the clean and already-applied branch schemas.
SELECT attach_event_trigger(
  'cardTransaction',
  ARRAY[]::TEXT[],
  ARRAY[]::TEXT[]
);
