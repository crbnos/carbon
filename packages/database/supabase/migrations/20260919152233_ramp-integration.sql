-- Ramp card-transaction subsystem, from-zero.
--
-- The entire cardTransaction / cardTransactionLine schema, its enums, tenant-
-- composite relationships, company-group account-integrity triggers, Draft-only
-- lifecycle + line-parent-lock triggers, RLS, the per-company document sequence,
-- the event-trigger attachment, the lifecycle-audit CHECK, and the
-- upsert_company_integration_patch RPC. Written as a single clean create; each
-- real DDL statement keeps its idempotent guard for the retryable deploy runner.

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

-- Tables ---------------------------------------------------------------------

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
  ),
  CONSTRAINT "cardTransaction_lifecycle_audit_check" CHECK (
    (
      status = 'Draft'
      AND "journalId" IS NULL
      AND "postedAt" IS NULL
      AND "postedBy" IS NULL
      AND "voidedAt" IS NULL
      AND "voidedBy" IS NULL
    )
    OR (
      status = 'Posted'
      AND "postingDate" IS NOT NULL
      AND "postedAt" IS NOT NULL
      AND "postedBy" IS NOT NULL
      AND "voidedAt" IS NULL
      AND "voidedBy" IS NULL
    )
    OR (
      status = 'Voided'
      AND "postingDate" IS NOT NULL
      AND "postedAt" IS NOT NULL
      AND "postedBy" IS NOT NULL
      AND "voidedAt" IS NOT NULL
      AND "voidedBy" IS NOT NULL
    )
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

SELECT attach_event_trigger(
  'cardTransaction',
  ARRAY[]::TEXT[],
  ARRAY[]::TEXT[]
);

-- Atomically patch declared company-integration metadata and Vault paths.
--
-- Callers send a flat {"dot.path": value} bag rather than a previously-read
-- metadata object. A logical-key advisory lock also serializes the first insert,
-- where no row exists yet for SELECT ... FOR UPDATE to lock.
CREATE OR REPLACE FUNCTION public.upsert_company_integration_patch(
  p_company_id text,
  p_integration_id text,
  p_metadata_patch jsonb DEFAULT '{}'::jsonb,
  p_secret_patch jsonb DEFAULT '{}'::jsonb,
  p_metadata_remove text[] DEFAULT ARRAY[]::text[],
  p_secret_remove text[] DEFAULT ARRAY[]::text[],
  p_active boolean DEFAULT NULL,
  p_updated_by text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault
AS $function$
DECLARE
  v_existing public."companyIntegration"%ROWTYPE;
  v_result public."companyIntegration"%ROWTYPE;
  v_exists boolean;
  v_metadata jsonb;
  v_secret jsonb := '{}'::jsonb;
  v_secret_ref text;
  v_secret_changed boolean;
  v_key text;
  v_path text[];
  v_value jsonb;
  v_index integer;
  v_vault_id uuid;
  v_vault_name text := 'integration:' || p_company_id || ':' || p_integration_id;
BEGIN
  IF p_company_id IS NULL OR p_company_id = '' THEN
    RAISE EXCEPTION 'company id is required';
  END IF;
  IF p_integration_id IS NULL OR p_integration_id = '' THEN
    RAISE EXCEPTION 'integration id is required';
  END IF;
  IF jsonb_typeof(COALESCE(p_metadata_patch, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'metadata patch must be a JSON object';
  END IF;
  IF jsonb_typeof(COALESCE(p_secret_patch, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'secret patch must be a JSON object';
  END IF;

  p_metadata_patch := COALESCE(p_metadata_patch, '{}'::jsonb);
  p_secret_patch := COALESCE(p_secret_patch, '{}'::jsonb);
  p_metadata_remove := COALESCE(p_metadata_remove, ARRAY[]::text[]);
  p_secret_remove := COALESCE(p_secret_remove, ARRAY[]::text[]);

  -- Serialize both existing-row updates and concurrent first-time upserts.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_company_id || E'\x1f' || p_integration_id, 0)
  );

  SELECT ci.* INTO v_existing
  FROM public."companyIntegration" ci
  WHERE ci."companyId" = p_company_id
    AND ci.id = p_integration_id
  FOR UPDATE;
  v_exists := FOUND;

  v_metadata := CASE
    WHEN v_exists THEN COALESCE(v_existing.metadata::jsonb, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  IF jsonb_typeof(v_metadata) <> 'object' THEN
    RAISE EXCEPTION 'stored integration metadata must be a JSON object';
  END IF;
  v_secret_ref := CASE WHEN v_exists THEN v_existing."secretRef" ELSE NULL END;

  FOREACH v_key IN ARRAY p_metadata_remove LOOP
    v_path := string_to_array(v_key, '.');
    IF v_key = '' OR array_position(v_path, '') IS NOT NULL THEN
      RAISE EXCEPTION 'invalid metadata remove path: %', v_key;
    END IF;
    v_metadata := v_metadata #- v_path;
  END LOOP;

  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_metadata_patch)
  LOOP
    v_path := string_to_array(v_key, '.');
    IF v_key = '' OR array_position(v_path, '') IS NOT NULL THEN
      RAISE EXCEPTION 'invalid metadata patch path: %', v_key;
    END IF;
    IF cardinality(v_path) > 1 THEN
      FOR v_index IN 1..cardinality(v_path) - 1 LOOP
        IF v_metadata #> v_path[1:v_index] IS NULL
          OR jsonb_typeof(v_metadata #> v_path[1:v_index]) <> 'object'
        THEN
          v_metadata := jsonb_set(
            v_metadata,
            v_path[1:v_index],
            '{}'::jsonb,
            true
          );
        END IF;
      END LOOP;
    END IF;
    v_metadata := jsonb_set(v_metadata, v_path, v_value, true);
  END LOOP;

  v_secret_changed := p_secret_patch <> '{}'::jsonb
    OR cardinality(p_secret_remove) > 0;
  IF v_secret_changed THEN
    IF v_secret_ref IS NOT NULL THEN
      SELECT ds.id, ds.decrypted_secret::jsonb INTO v_vault_id, v_secret
      FROM vault.decrypted_secrets ds
      WHERE ds.id = v_secret_ref::uuid;
      IF NOT FOUND OR jsonb_typeof(v_secret) <> 'object' THEN
        RAISE EXCEPTION 'stored integration secret is unavailable';
      END IF;
    ELSE
      -- Recover a deterministic Vault record whose row pointer was lost. Load
      -- its whole bag before patching so adopting it cannot erase siblings.
      SELECT ds.id, ds.decrypted_secret::jsonb INTO v_vault_id, v_secret
      FROM vault.decrypted_secrets ds
      WHERE ds.name = v_vault_name;
      IF FOUND THEN
        IF jsonb_typeof(v_secret) <> 'object' THEN
          RAISE EXCEPTION 'stored integration secret is unavailable';
        END IF;
        v_secret_ref := v_vault_id::text;
      ELSE
        -- SELECT INTO clears its targets when no row is found. Restore the
        -- empty bag before applying the first secret patch.
        v_secret := '{}'::jsonb;
      END IF;
    END IF;

    FOREACH v_key IN ARRAY p_secret_remove LOOP
      IF v_key = '' OR array_position(string_to_array(v_key, '.'), '') IS NOT NULL THEN
        RAISE EXCEPTION 'invalid secret remove path: %', v_key;
      END IF;
      -- Vault bags intentionally use literal flat dot-path keys; the TS reader
      -- expands each key back into nested metadata with setPath().
      v_secret := v_secret - v_key;
    END LOOP;

    FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_secret_patch)
    LOOP
      IF v_key = '' OR array_position(string_to_array(v_key, '.'), '') IS NOT NULL THEN
        RAISE EXCEPTION 'invalid secret patch path: %', v_key;
      END IF;
      v_secret := v_secret || jsonb_build_object(v_key, v_value);
    END LOOP;

    IF v_secret = '{}'::jsonb THEN
      IF v_secret_ref IS NOT NULL THEN
        DELETE FROM vault.secrets WHERE id = v_secret_ref::uuid;
      END IF;
      v_secret_ref := NULL;
    ELSIF v_secret_ref IS NULL THEN
      v_vault_id := vault.create_secret(
        v_secret::text,
        v_vault_name,
        'Carbon integration secret'
      );
      v_secret_ref := v_vault_id::text;
    ELSE
      PERFORM vault.update_secret(v_secret_ref::uuid, v_secret::text);
    END IF;
  END IF;

  IF v_exists THEN
    UPDATE public."companyIntegration"
    SET metadata = v_metadata::json,
        active = COALESCE(p_active, v_existing.active),
        "secretRef" = v_secret_ref,
        "updatedBy" = COALESCE(p_updated_by, v_existing."updatedBy"),
        "updatedAt" = now()
    WHERE id = p_integration_id
      AND "companyId" = p_company_id
    RETURNING * INTO v_result;
  ELSE
    INSERT INTO public."companyIntegration" (
      id,
      "companyId",
      metadata,
      active,
      "secretRef",
      "updatedBy"
    ) VALUES (
      p_integration_id,
      p_company_id,
      v_metadata::json,
      COALESCE(p_active, false),
      v_secret_ref,
      p_updated_by
    )
    RETURNING * INTO v_result;
  END IF;

  RETURN to_jsonb(v_result);
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_company_integration_patch(
  text, text, jsonb, jsonb, text[], text[], boolean, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_company_integration_patch(
  text, text, jsonb, jsonb, text[], text[], boolean, text
) TO service_role;

NOTIFY pgrst, 'reload schema';
