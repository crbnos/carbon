-- Projects Phase 2a: project stock transfers (Transfer, Borrow, Payback).
-- Spec: .ai/specs/2026-10-03-projects.md (Phase 2: Project stock)
-- Enum values ship alone: a new value cannot be used in the transaction that adds it.

CREATE TYPE "projectStockTransferType" AS ENUM ('Transfer', 'Borrow', 'Payback');
CREATE TYPE "projectStockTransferStatus" AS ENUM ('Draft', 'Approved', 'Posted', 'Cancelled');
CREATE TYPE "projectBorrowStatus" AS ENUM ('Open', 'Paid Back');
ALTER TYPE "itemLedgerDocumentType" ADD VALUE IF NOT EXISTS 'Project Transfer';
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Project Transfer';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Project Transfer';
