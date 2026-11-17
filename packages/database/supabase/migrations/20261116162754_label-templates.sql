-- BinderyPress templates are chosen per label type and media size, company-wide.
-- They replace the single template a printer route carried for every label.
CREATE TABLE "labelTemplate" (
  "id" TEXT NOT NULL DEFAULT id('lt'),
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "labelType" TEXT NOT NULL CHECK (
    "labelType" IN ('serialLabel', 'batchLabel', 'kanbanCard', 'storageUnitLabel')
  ),
  "mediaSizeId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMPTZ,
  PRIMARY KEY ("id", "companyId")
);

-- Leads with the print-time lookup (company + the printer's media size).
CREATE UNIQUE INDEX "labelTemplate_mediaSizeId_labelType_unique"
  ON "labelTemplate" ("companyId", "mediaSizeId", "labelType");

ALTER TABLE "labelTemplate" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "printerRoute" DROP COLUMN IF EXISTS "templateId";
