-- Implementation Hub v2: where each tick and each row came from, staff
-- verification of ticks, and one assignee per hub item.
--
-- Rules and event triggers for the new table live in the authz manifest and
-- the event attachments, not here (see authz-manifest.md).

-- Who wrote a tick or a row. Ticks use customer, staff and mcp; rows can also
-- come from the sales handover or an AI interview. Rows written before this
-- migration keep NULL: their source is unknown.
CREATE TYPE "implementationSource" AS ENUM (
  'customer',
  'staff',
  'mcp',
  'handover',
  'interview'
);

-- A tick records its source. Carbon staff stamp verifiedAt/verifiedBy when they
-- verify a gate; the app clears both when the value changes again.
ALTER TABLE "implementationCheckState"
  ADD COLUMN "source" "implementationSource",
  ADD COLUMN "verifiedAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN "verifiedBy" TEXT REFERENCES "user"("id");

CREATE INDEX "implementationCheckState_verifiedBy_idx"
  ON "implementationCheckState" ("verifiedBy");

-- A custom row (requirement, objective, open question, customization) records
-- its source, and a reference to its evidence: a link, a document name, or the
-- handover question it came from.
ALTER TABLE "implementationRow"
  ADD COLUMN "source" "implementationSource",
  ADD COLUMN "sourceRef" TEXT;

-- One assignee per hub item. The item key is the status key of the item:
-- task:<key>, flag:setup.<key or row id>, or row:<row id>.
CREATE TABLE "implementationAssignment" (
    "id" TEXT NOT NULL DEFAULT id(),
    "companyId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL REFERENCES "user"("id"),

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "implementationAssignment_companyId_itemKey_key"
      UNIQUE ("companyId", "itemKey")
);

CREATE INDEX "implementationAssignment_companyId_idx"
  ON "implementationAssignment" ("companyId");
CREATE INDEX "implementationAssignment_assigneeId_idx"
  ON "implementationAssignment" ("assigneeId");
CREATE INDEX "implementationAssignment_createdBy_idx"
  ON "implementationAssignment" ("createdBy");
CREATE INDEX "implementationAssignment_updatedBy_idx"
  ON "implementationAssignment" ("updatedBy");

ALTER TABLE "implementationAssignment" ENABLE ROW LEVEL SECURITY;
