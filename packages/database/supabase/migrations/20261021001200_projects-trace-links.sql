-- Projects Phase 1b: trace links, the Requirement / Test Case / Parameter fields of an
-- element, and the part link serial.
-- Spec: .ai/specs/2026-10-03-projects.md (Trace links, Verification, Parameters and
-- allocations, Part links)

-- 1) Element fields --------------------------------------------------------------------
ALTER TABLE "projectElement"
  ADD COLUMN IF NOT EXISTS "targetOperator" "requirementTargetOperator",
  ADD COLUMN IF NOT EXISTS "targetValue" NUMERIC,
  ADD COLUMN IF NOT EXISTS "targetUpperValue" NUMERIC,
  ADD COLUMN IF NOT EXISTS "targetUnit" TEXT,
  ADD COLUMN IF NOT EXISTS "verificationMethod" "requirementVerificationMethod",
  ADD COLUMN IF NOT EXISTS "actualParameterId" TEXT,
  ADD COLUMN IF NOT EXISTS "qualityDocumentId" TEXT REFERENCES "qualityDocument"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "verdict" "testCaseVerdict",
  ADD COLUMN IF NOT EXISTS "verdictAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "verdictBy" TEXT REFERENCES "user"("id"),
  ADD COLUMN IF NOT EXISTS "parameterValue" NUMERIC,
  ADD COLUMN IF NOT EXISTS "parameterUnit" TEXT,
  ADD COLUMN IF NOT EXISTS "parameterSource" "parameterSource",
  ADD COLUMN IF NOT EXISTS "allocationPercent" NUMERIC CHECK ("allocationPercent" IS NULL OR ("allocationPercent" >= 0 AND "allocationPercent" <= 1)),
  ADD COLUMN IF NOT EXISTS "requirementCategory" "requirementCategory",
  ADD COLUMN IF NOT EXISTS "parameterFormula" TEXT,
  ADD COLUMN IF NOT EXISTS "parameterItemField" TEXT,
  ADD COLUMN IF NOT EXISTS "parameterContingencyPercent" NUMERIC CHECK ("parameterContingencyPercent" IS NULL OR ("parameterContingencyPercent" >= 0 AND "parameterContingencyPercent" <= 1));
ALTER TABLE "projectElement"
  ADD CONSTRAINT "projectElement_formula_check" CHECK ("parameterSource" IS DISTINCT FROM 'Formula' OR "parameterFormula" IS NOT NULL),
  ADD CONSTRAINT "projectElement_itemField_check" CHECK ("parameterSource" IS DISTINCT FROM 'Item' OR "parameterItemField" IS NOT NULL);
ALTER TABLE "projectElement"
  ADD CONSTRAINT "projectElement_actualParameter_fkey" FOREIGN KEY ("actualParameterId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId") ON DELETE SET NULL ("actualParameterId"),
  ADD CONSTRAINT "projectElement_range_check" CHECK ("targetOperator" IS DISTINCT FROM 'Range' OR "targetUpperValue" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "projectElement_actualParameterId_idx" ON "projectElement" ("actualParameterId", "projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectElement_qualityDocumentId_idx" ON "projectElement" ("qualityDocumentId");
CREATE INDEX IF NOT EXISTS "projectElement_verdictBy_idx" ON "projectElement" ("verdictBy");

-- 2) Trace links -----------------------------------------------------------------------
-- Both ends are in one project: the composite FKs include "projectId".
CREATE TABLE IF NOT EXISTS "projectElementLink" (
  "id" TEXT NOT NULL DEFAULT id('pjk'),
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "fromElementId" TEXT NOT NULL,
  "toElementId" TEXT NOT NULL,
  "linkType" "projectElementLinkType" NOT NULL,
  "suspectSince" TIMESTAMP WITH TIME ZONE,
  "reviewedAt" TIMESTAMP WITH TIME ZONE,
  "reviewedBy" TEXT REFERENCES "user"("id"),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "projectElementLink_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "projectElementLink_key" UNIQUE ("fromElementId", "toElementId", "linkType", "companyId"),
  CONSTRAINT "projectElementLink_from_fkey" FOREIGN KEY ("fromElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectElementLink_to_fkey" FOREIGN KEY ("toElementId", "projectId", "companyId") REFERENCES "projectElement"("id", "projectId", "companyId") ON DELETE CASCADE,
  CONSTRAINT "projectElementLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "projectElementLink_self_check" CHECK ("fromElementId" <> "toElementId")
);

CREATE INDEX IF NOT EXISTS "projectElementLink_companyId_idx" ON "projectElementLink" ("companyId");
CREATE INDEX IF NOT EXISTS "projectElementLink_projectId_idx" ON "projectElementLink" ("projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectElementLink_fromElementId_idx" ON "projectElementLink" ("fromElementId", "projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectElementLink_toElementId_idx" ON "projectElementLink" ("toElementId", "projectId", "companyId");
CREATE INDEX IF NOT EXISTS "projectElementLink_reviewedBy_idx" ON "projectElementLink" ("reviewedBy");
CREATE INDEX IF NOT EXISTS "projectElementLink_createdBy_idx" ON "projectElementLink" ("createdBy");
CREATE INDEX IF NOT EXISTS "projectElementLink_updatedBy_idx" ON "projectElementLink" ("updatedBy");

-- RLS: the policies are rendered from packages/database/src/authz/manifest.ts.

-- 3) Part link serial ------------------------------------------------------------------
-- projectElement."itemId" exists from Phase 1a.
ALTER TABLE "projectElement" ADD COLUMN IF NOT EXISTS "trackedEntityId" TEXT REFERENCES "trackedEntity"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "projectElement_trackedEntityId_idx" ON "projectElement" ("trackedEntityId") WHERE "trackedEntityId" IS NOT NULL;

-- A serial must belong to the element's item. A serial with no item set fills it.
CREATE OR REPLACE FUNCTION "projectElement_part_link_check"() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_item TEXT;
BEGIN
  IF NEW."trackedEntityId" IS NULL THEN RETURN NEW; END IF;
  SELECT "itemId" INTO v_item FROM "trackedEntity" WHERE "id" = NEW."trackedEntityId" AND "companyId" = NEW."companyId";
  IF v_item IS NULL THEN RAISE EXCEPTION 'The serial % has no item in this company', NEW."trackedEntityId"; END IF;
  IF NEW."itemId" IS NULL THEN NEW."itemId" := v_item;
  ELSIF NEW."itemId" <> v_item THEN RAISE EXCEPTION 'The serial belongs to a different item'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "projectElement_part_link_check" BEFORE INSERT OR UPDATE OF "itemId", "trackedEntityId"
  ON "projectElement" FOR EACH ROW EXECUTE FUNCTION "projectElement_part_link_check"();

-- 4) A Parameter cannot link a part.
ALTER TABLE "projectElement"
  ADD CONSTRAINT "projectElement_parameter_part_check" CHECK ("type" <> 'Parameter' OR ("itemId" IS NULL AND "trackedEntityId" IS NULL));
