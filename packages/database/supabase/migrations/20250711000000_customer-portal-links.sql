ALTER TYPE "externalLinkDocumentType" ADD VALUE IF NOT EXISTS 'Customer';

ALTER TABLE "externalLink" ADD CONSTRAINT "externalLink_documentId_documentType_unique" UNIQUE ("documentId", "documentType", "companyId");


