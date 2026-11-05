-- Part files (a line item's model and the files on its Files tab) go to a
-- supplier only when picked in the send dialog.
--
-- "includeSupplierPartFiles": whether the RFQ and supplier quote send dialogs
-- start with every part file ticked. On by default: the RFQ email already
-- attached each part's model.
--
-- "sharedFilePaths": the storage paths of the part files a supplier quote was
-- sent with. Its share page lists only these.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "includeSupplierPartFiles" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "supplierQuote"
  ADD COLUMN IF NOT EXISTS "sharedFilePaths" TEXT[] NOT NULL DEFAULT '{}';
