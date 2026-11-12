-- An inspection plan's parameters: fixed key/value pairs the author sets
-- ("Ambient temp" / "20 ±2 °C") and the inspector reads on every lot of the
-- plan. The plan editor mints the ids (`idp_…`) and saves the whole list.

CREATE TABLE "inspectionDocumentParameter" (
  "id" TEXT NOT NULL DEFAULT id('idp'),
  "inspectionDocumentId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL DEFAULT '',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  PRIMARY KEY ("id", "companyId"),
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  FOREIGN KEY ("inspectionDocumentId", "companyId")
    REFERENCES "inspectionDocument"("id", "companyId")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "inspectionDocumentParameter_companyId_idx"
  ON "inspectionDocumentParameter" ("companyId");
CREATE INDEX "inspectionDocumentParameter_inspectionDocumentId_idx"
  ON "inspectionDocumentParameter" ("inspectionDocumentId", "companyId");
CREATE INDEX "inspectionDocumentParameter_createdBy_idx"
  ON "inspectionDocumentParameter" ("createdBy");
CREATE INDEX "inspectionDocumentParameter_updatedBy_idx"
  ON "inspectionDocumentParameter" ("updatedBy");
