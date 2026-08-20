-- EDI Support (Phase 1, sell-side via provider)
-- Spec: .ai/specs/2026-08-04-edi-support.md
-- Adds trading-partner config, document staging/status lifecycle, cross-reference
-- tables, the provider integration seed, and the EDI event-system handler type.
-- Idempotent throughout: the deploy runner retries failed files over committed
-- partial state.

-- =============================================================================
-- Enums (capitalized, display-friendly per house convention)
-- =============================================================================
DO $$ BEGIN
  CREATE TYPE "ediDocumentType" AS ENUM
    ('Purchase Order', 'Purchase Order Acknowledgment', 'Advance Ship Notice', 'Invoice');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ediDocumentDirection" AS ENUM ('Inbound', 'Outbound');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ediDocumentStatus" AS ENUM
    ('Received', 'Needs Review', 'Posted', 'Rejected', 'Pending', 'Sent', 'Acknowledged', 'Failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ediReleaseMode" AS ENUM ('Automatic', 'Review');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- Tables
-- =============================================================================

-- Trading partner profile: the central config entity (one per customer)
CREATE TABLE IF NOT EXISTS "ediTradingPartner" (
    "id" TEXT NOT NULL DEFAULT id('editp'),
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "externalId" TEXT,                     -- provider partnership/trading-partner id
    "active" BOOLEAN NOT NULL DEFAULT FALSE,
    "releaseMode" "ediReleaseMode" NOT NULL DEFAULT 'Review',
    "priceTolerancePercent" NUMERIC NOT NULL DEFAULT 0,   -- fraction 0-1, house convention
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    CONSTRAINT "ediTradingPartner_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "ediTradingPartner_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ediTradingPartner_customerId_fkey" FOREIGN KEY ("customerId", "companyId")
      REFERENCES "customer"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "ediTradingPartner_customer_unique" UNIQUE ("customerId", "companyId")
);

-- Per-partner document enablement (extensible to 860/846/... without schema change)
CREATE TABLE IF NOT EXISTS "ediTradingPartnerDocument" (
    "id" TEXT NOT NULL DEFAULT id('editpd'),
    "companyId" TEXT NOT NULL,
    "tradingPartnerId" TEXT NOT NULL,
    "documentType" "ediDocumentType" NOT NULL,
    "direction" "ediDocumentDirection" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "ediTradingPartnerDocument_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "ediTradingPartnerDocument_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ediTradingPartnerDocument_partner_fkey" FOREIGN KEY ("tradingPartnerId", "companyId")
      REFERENCES "ediTradingPartner"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "ediTradingPartnerDocument_unique"
      UNIQUE ("tradingPartnerId", "documentType", "direction", "companyId")
);

-- Buyer ship-to location code -> Carbon customer location (the EDPAR idea)
CREATE TABLE IF NOT EXISTS "ediTradingPartnerLocation" (
    "id" TEXT NOT NULL DEFAULT id('editpl'),
    "companyId" TEXT NOT NULL,
    "tradingPartnerId" TEXT NOT NULL,
    "externalCode" TEXT NOT NULL,          -- buyer's store/DC/DUNS location code
    "customerLocationId" TEXT NOT NULL REFERENCES "customerLocation"("id") ON DELETE CASCADE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "ediTradingPartnerLocation_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "ediTradingPartnerLocation_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ediTradingPartnerLocation_partner_fkey" FOREIGN KEY ("tradingPartnerId", "companyId")
      REFERENCES "ediTradingPartner"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "ediTradingPartnerLocation_unique"
      UNIQUE ("tradingPartnerId", "externalCode", "companyId")
);

-- The staged EDI document: message-as-truth record with status lifecycle
CREATE TABLE IF NOT EXISTS "ediDocument" (
    "id" TEXT NOT NULL DEFAULT id('edi'),
    "companyId" TEXT NOT NULL,
    "tradingPartnerId" TEXT,               -- nullable: unresolved partner is itself an issue
    "direction" "ediDocumentDirection" NOT NULL,
    "documentType" "ediDocumentType" NOT NULL,
    "status" "ediDocumentStatus" NOT NULL,
    "externalId" TEXT,                     -- provider transaction id (dedup + ack correlation)
    "partnerReference" TEXT,               -- buyer PO number
    "payload" JSONB NOT NULL,              -- canonical JSON (immutable after insert)
    "issues" JSONB NOT NULL DEFAULT '[]',  -- [{ code, message, path?, resolvedAt? }]
    "sourceDocument" TEXT,                 -- 'Sales Order' | 'Shipment' | 'Sales Invoice'
    "sourceDocumentId" TEXT,
    "sourceDocumentReadableId" TEXT,
    "acknowledgedAt" TIMESTAMP WITH TIME ZONE,
    "releasedBy" TEXT REFERENCES "user"("id"),
    "releasedAt" TIMESTAMP WITH TIME ZONE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    CONSTRAINT "ediDocument_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "ediDocument_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ediDocument_partner_fkey" FOREIGN KEY ("tradingPartnerId", "companyId")
      REFERENCES "ediTradingPartner"("id", "companyId") ON DELETE SET NULL
);

-- =============================================================================
-- Indexes (companyId + every FK, per conventions-database.md)
-- =============================================================================
CREATE INDEX IF NOT EXISTS "ediTradingPartner_companyId_idx" ON "ediTradingPartner" ("companyId");
CREATE INDEX IF NOT EXISTS "ediTradingPartner_customerId_idx" ON "ediTradingPartner" ("customerId");
CREATE INDEX IF NOT EXISTS "ediTradingPartner_createdBy_idx" ON "ediTradingPartner" ("createdBy");
CREATE INDEX IF NOT EXISTS "ediTradingPartnerDocument_companyId_idx" ON "ediTradingPartnerDocument" ("companyId");
CREATE INDEX IF NOT EXISTS "ediTradingPartnerDocument_partner_idx" ON "ediTradingPartnerDocument" ("tradingPartnerId");
CREATE INDEX IF NOT EXISTS "ediTradingPartnerDocument_createdBy_idx" ON "ediTradingPartnerDocument" ("createdBy");
CREATE INDEX IF NOT EXISTS "ediTradingPartnerLocation_companyId_idx" ON "ediTradingPartnerLocation" ("companyId");
CREATE INDEX IF NOT EXISTS "ediTradingPartnerLocation_partner_idx" ON "ediTradingPartnerLocation" ("tradingPartnerId");
CREATE INDEX IF NOT EXISTS "ediTradingPartnerLocation_customerLocationId_idx" ON "ediTradingPartnerLocation" ("customerLocationId");
CREATE INDEX IF NOT EXISTS "ediTradingPartnerLocation_createdBy_idx" ON "ediTradingPartnerLocation" ("createdBy");
CREATE UNIQUE INDEX IF NOT EXISTS "ediDocument_externalId_unique"
  ON "ediDocument" ("companyId", "externalId") WHERE "externalId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "ediDocument_status_idx" ON "ediDocument" ("companyId", "status");
CREATE INDEX IF NOT EXISTS "ediDocument_partner_idx" ON "ediDocument" ("companyId", "tradingPartnerId");
CREATE INDEX IF NOT EXISTS "ediDocument_createdBy_idx" ON "ediDocument" ("createdBy");

-- =============================================================================
-- RLS (standard four policies; SELECT uses the tightened sales_view variant
-- per the spec's acceptance criteria)
-- =============================================================================
ALTER TABLE "public"."ediTradingPartner" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."ediTradingPartner";
CREATE POLICY "SELECT" ON "public"."ediTradingPartner" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."ediTradingPartner";
CREATE POLICY "INSERT" ON "public"."ediTradingPartner" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."ediTradingPartner";
CREATE POLICY "UPDATE" ON "public"."ediTradingPartner" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."ediTradingPartner";
CREATE POLICY "DELETE" ON "public"."ediTradingPartner" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

ALTER TABLE "public"."ediTradingPartnerDocument" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."ediTradingPartnerDocument";
CREATE POLICY "SELECT" ON "public"."ediTradingPartnerDocument" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."ediTradingPartnerDocument";
CREATE POLICY "INSERT" ON "public"."ediTradingPartnerDocument" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."ediTradingPartnerDocument";
CREATE POLICY "UPDATE" ON "public"."ediTradingPartnerDocument" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."ediTradingPartnerDocument";
CREATE POLICY "DELETE" ON "public"."ediTradingPartnerDocument" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

ALTER TABLE "public"."ediTradingPartnerLocation" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."ediTradingPartnerLocation";
CREATE POLICY "SELECT" ON "public"."ediTradingPartnerLocation" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."ediTradingPartnerLocation";
CREATE POLICY "INSERT" ON "public"."ediTradingPartnerLocation" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."ediTradingPartnerLocation";
CREATE POLICY "UPDATE" ON "public"."ediTradingPartnerLocation" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."ediTradingPartnerLocation";
CREATE POLICY "DELETE" ON "public"."ediTradingPartnerLocation" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

ALTER TABLE "public"."ediDocument" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SELECT" ON "public"."ediDocument";
CREATE POLICY "SELECT" ON "public"."ediDocument" FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[])
);
DROP POLICY IF EXISTS "INSERT" ON "public"."ediDocument";
CREATE POLICY "INSERT" ON "public"."ediDocument" FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_create'))::text[])
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."ediDocument";
CREATE POLICY "UPDATE" ON "public"."ediDocument" FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_update'))::text[])
);
DROP POLICY IF EXISTS "DELETE" ON "public"."ediDocument";
CREATE POLICY "DELETE" ON "public"."ediDocument" FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_delete'))::text[])
);

-- =============================================================================
-- Provider integration seed row (Linear precedent)
-- =============================================================================
INSERT INTO "integration" ("id", "jsonschema")
VALUES ('orderful',
  '{"type":"object","properties":{"apiKey":{"type":"string"},"webhookSecret":{"type":"string"},"environment":{"type":"string","enum":["sandbox","production"]}},"required":["apiKey","webhookSecret"]}')
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- Event-system additions
-- =============================================================================
-- Widen the handlerType CHECK (current list from 20260326120000)
ALTER TABLE "eventSystemSubscription" DROP CONSTRAINT IF EXISTS "eventSystemSubscription_handlerType_check";
ALTER TABLE "eventSystemSubscription" ADD CONSTRAINT "eventSystemSubscription_handlerType_check"
  CHECK ("handlerType" IN ('WEBHOOK','WORKFLOW','SYNC','SEARCH','AUDIT','EMBEDDING','EDI'));

-- Attach async event triggers to "shipment" ONLY if absent. Do NOT re-call
-- attach_event_trigger for "salesOrder"/"salesInvoice" (already attached with
-- interceptors in 20260119084845 / 20260410031804 / 20260205180700; re-calling
-- with empty arrays would DROP those existing interceptors).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = '"shipment"'::regclass AND tgname LIKE 'trg_event_async_%'
  ) THEN
    PERFORM attach_event_trigger('shipment', ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
  END IF;
END $$;
