-- Add external_id column to address table
ALTER TABLE address ADD COLUMN "externalId" JSONB;

-- Create GIN index on external_id column
CREATE INDEX idx_address_external_id ON address USING GIN ("externalId");

-- Add external_id column to address table
ALTER TABLE "customerLocation" ADD COLUMN "externalId" JSONB;

-- Create GIN index on external_id column
CREATE INDEX idx_customerLocation_external_id ON "customerLocation" USING GIN ("externalId");


ALTER TABLE "supplierLocation" ADD COLUMN "externalId" JSONB;

-- Create GIN index on external_id column
CREATE INDEX idx_supplierLocation_external_id ON "supplierLocation" USING GIN ("externalId");