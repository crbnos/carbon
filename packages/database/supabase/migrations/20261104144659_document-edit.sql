-- Edits to one document: how one purchase order, invoice, quote (and so on)
-- prints, on top of the company's document template. Only the changes are
-- stored, in the template's own shape, so a word left alone still follows the
-- template.
CREATE TABLE "documentEdit" (
    "id" TEXT NOT NULL DEFAULT id('dedit'),
    "companyId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    -- The record the document prints (a purchaseOrder, a shipment for a packing
    -- slip, a job for a traveler...). No FK: it points at one of 11 tables.
    "documentId" TEXT NOT NULL,
    -- Per block id: { text?, hidden?, visible?, content? }.
    "blocks" JSONB NOT NULL DEFAULT '{}',
    -- The document's own texts: { text?, hidden? }.
    "settings" JSONB NOT NULL DEFAULT '{}',

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "documentEdit_documentType_check" CHECK ("documentType" IN (
      'purchaseOrder', 'purchaseReturnOrder', 'purchasingRfq', 'quote',
      'salesOrder', 'salesReturnOrder', 'salesInvoice', 'packingSlip',
      'stockTransfer', 'jobTraveler', 'issue'
    ))
);

CREATE INDEX "documentEdit_companyId_idx" ON "documentEdit" ("companyId");
CREATE INDEX "documentEdit_createdBy_idx" ON "documentEdit" ("createdBy");
CREATE INDEX "documentEdit_updatedBy_idx" ON "documentEdit" ("updatedBy");

-- One set of edits per document.
ALTER TABLE "documentEdit" ADD CONSTRAINT "documentEdit_companyId_documentType_documentId_key"
    UNIQUE ("companyId", "documentType", "documentId");

ALTER TABLE "public"."documentEdit" ENABLE ROW LEVEL SECURITY;
