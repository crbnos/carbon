-- Add external_id column to customer table
ALTER TABLE customer ADD COLUMN "externalId" JSONB;

-- Create GIN index on external_id column
CREATE INDEX idx_customer_external_id ON customer USING GIN ("externalId");

-- Add external_id column to supplier table
ALTER TABLE supplier ADD COLUMN "externalId" JSONB;

-- Create GIN index on external_id column
CREATE INDEX idx_supplier_external_id ON supplier USING GIN ("externalId");
