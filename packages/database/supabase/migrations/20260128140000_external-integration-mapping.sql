-- External Integration Mapping Table
-- A generic mapping table for linking Carbon entities to external system entities (Xero, QuickBooks, etc.)
-- This replaces the externalId JSONB column pattern with a proper relational approach.

CREATE TABLE "externalIntegrationMapping" (
  "id" TEXT NOT NULL DEFAULT id(),
  
  -- Generic entity reference (Carbon side)
  "entityType" TEXT NOT NULL,           -- 'customer', 'supplier', 'item', 'contact', 'purchaseOrder', etc.
  "entityId" TEXT NOT NULL,             -- The internal Carbon ID
  
  -- External system reference
  "integration" TEXT NOT NULL,          -- 'xero', 'linear', 'quickbooks', etc.
  "externalId" TEXT NOT NULL,           -- The ID in the external system
  
  -- Mapping configuration
  "allowDuplicateExternalId" BOOLEAN NOT NULL DEFAULT false,  -- When true, allows many Carbon entities to map to one external ID
  
  -- Sync metadata
  "metadata" JSONB,                     -- Provider-specific extras
  "lastSyncedAt" TIMESTAMP WITH TIME ZONE,
  "remoteUpdatedAt" TIMESTAMP WITH TIME ZONE,  -- For fast bailout on pull
  
  -- Audit
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT,
  
  -- Multi-tenancy
  "companyId" TEXT NOT NULL,

  CONSTRAINT "externalIntegrationMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "externalIntegrationMapping_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "externalIntegrationMapping_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  
  
  -- One mapping per integration per entity (always enforced)
  CONSTRAINT "externalIntegrationMapping_entityType_entityId_integration_companyId_key" UNIQUE ("entityType", "entityId", "integration", "companyId")
);

-- Partial unique index: Only enforce external ID uniqueness when allowDuplicateExternalId is false
-- This allows many-to-one (Carbon to External) mappings when explicitly configured
CREATE UNIQUE INDEX "externalIntegrationMapping_unique_externalId_idx"
ON "externalIntegrationMapping" ("integration", "externalId", "entityType", "companyId")
WHERE "allowDuplicateExternalId" = false;

-- Indexes for common query patterns
CREATE INDEX "externalIntegrationMapping_entity_idx" ON "externalIntegrationMapping"("entityType", "entityId");
CREATE INDEX "externalIntegrationMapping_lookup_idx" ON "externalIntegrationMapping"("integration", "externalId", "companyId");
CREATE INDEX "externalIntegrationMapping_companyId_idx" ON "externalIntegrationMapping"("companyId");

-- Enable RLS
ALTER TABLE "externalIntegrationMapping" ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "manage_externalIntegrationMapping" ON "externalIntegrationMapping"
FOR ALL USING ( auth.role() = 'authenticated' ); 
