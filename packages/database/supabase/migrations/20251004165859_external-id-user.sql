ALTER TABLE "user" ADD COLUMN "externalId" JSONB;
CREATE INDEX idx_user_external_id ON "user" USING GIN ("externalId");

ALTER TABLE "company" ADD COLUMN "externalId" JSONB;
CREATE INDEX idx_company_external_id ON "company" USING GIN ("externalId");