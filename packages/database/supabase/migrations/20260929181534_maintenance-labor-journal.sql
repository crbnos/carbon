-- Maintenance labor: time on a maintenance dispatch is expensed at the work
-- center's labor rate (Dr maintenanceAccount / Cr laborAbsorptionAccount) by
-- the post-maintenance-event edge function. Its journals and lines need their
-- own source/document type — "Production Event" lines carry a job id and
-- "Maintenance Consumption" is spare parts.
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Maintenance Event';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Maintenance Event';
