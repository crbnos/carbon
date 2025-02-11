ALTER TABLE "item"
  ADD CONSTRAINT "item_modelUploadId_fkey"
  FOREIGN KEY ("modelUploadId") REFERENCES "modelUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "item_modelUploadId_idx" ON "item" ("modelUploadId");

ALTER TABLE "quoteLine"
  ADD CONSTRAINT "quoteLine_modelUploadId_fkey"
  FOREIGN KEY ("modelUploadId") REFERENCES "modelUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "quoteLine_modelUploadId_idx" ON "quoteLine" ("modelUploadId");

ALTER TABLE "salesRfqLine"
  ADD CONSTRAINT "salesRfqLine_modelUploadId_fkey"
  FOREIGN KEY ("modelUploadId") REFERENCES "modelUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "salesRfqLine_modelUploadId_idx" ON "salesRfqLine" ("modelUploadId");
