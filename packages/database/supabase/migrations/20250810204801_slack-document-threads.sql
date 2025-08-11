-- Drop the specific non-conformance Slack thread table
DROP TABLE IF EXISTS "nonConformanceSlackThread";

-- Create generic document thread mapping table
CREATE TABLE "slackDocumentThread" (
  "id" TEXT NOT NULL DEFAULT id('slack'),
  "companyId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL, -- e.g., 'nonConformance', 'quote', 'salesOrder', 'job'
  "documentId" TEXT NOT NULL,   -- The ID of the document in its respective table
  "channelId" TEXT NOT NULL,
  "threadTs" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "slackDocumentThread_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "slackDocumentThread_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "slackDocumentThread_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "slackDocumentThread_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "slackDocumentThread_unique" UNIQUE ("documentType", "documentId", "companyId")
);

-- Create indexes for efficient lookups
CREATE INDEX "slackDocumentThread_companyId_idx" ON "slackDocumentThread" ("companyId");
CREATE INDEX "slackDocumentThread_documentType_documentId_idx" ON "slackDocumentThread" ("documentType", "documentId");
CREATE INDEX "slackDocumentThread_channelId_threadTs_idx" ON "slackDocumentThread" ("channelId", "threadTs");

-- Enable Row Level Security
ALTER TABLE "slackDocumentThread" ENABLE ROW LEVEL SECURITY;


-- Create an enum for document types to ensure consistency
CREATE TYPE documentThreadType AS ENUM (
  'nonConformance',
  'quote', 
  'salesOrder',
  'job',
  'purchaseOrder',
  'invoice',
  'receipt',
  'shipment'
);

-- Add check constraint to ensure documentType uses valid values
ALTER TABLE "slackDocumentThread" 
ADD CONSTRAINT "slackDocumentThread_documentType_check" 
CHECK ("documentType"::documentThreadType IS NOT NULL);