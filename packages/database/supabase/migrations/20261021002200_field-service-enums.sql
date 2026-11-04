-- Enums for Field Service Phase A and Service projects.
-- Enum additions live alone: a new enum value cannot be used in the transaction that adds it.
-- Specs: .ai/specs/2026-10-08-field-service.md, .ai/specs/2026-10-03-projects.md (Service projects)
-- trackedActivity.type is TEXT, so the 'Service' activity type needs no enum change.

ALTER TYPE "module" ADD VALUE IF NOT EXISTS 'Service';
ALTER TYPE "projectCostTreatment" ADD VALUE IF NOT EXISTS 'By Coverage';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Project Expense';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Project Expense';
CREATE TYPE "projectType" AS ENUM ('Standard', 'Service');
CREATE TYPE "serviceCoverage" AS ENUM ('Warranty', 'Contract', 'Billable', 'Capitalized');
CREATE TYPE "projectBillableItemStatus" AS ENUM ('Unbilled', 'On Hold', 'Billed', 'Written Off');
CREATE TYPE "serviceOrderType" AS ENUM ('Field Visit', 'Depot Repair', 'Refurbishment');
CREATE TYPE "serviceOrderStatus" AS ENUM ('Draft', 'Scheduled', 'In Progress', 'On Hold', 'Completed', 'Closed', 'Cancelled');
CREATE TYPE "serviceVisitStatus" AS ENUM ('Scheduled', 'Traveling', 'On Site', 'Completed', 'Cancelled');
CREATE TYPE "customerAssetStatus" AS ENUM ('In Service', 'At Depot', 'Returned');
CREATE TYPE "serviceInvoiceDetail" AS ENUM ('Itemized', 'By Node');
