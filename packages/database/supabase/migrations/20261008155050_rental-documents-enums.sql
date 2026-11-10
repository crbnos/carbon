-- Rental shipments and receipts (.ai/specs/2026-10-07-rental-shipments-and-receipts.md).
-- Enums only: an ADD VALUE cannot share a transaction with statements that use it.
ALTER TYPE "shipmentSourceDocument" ADD VALUE IF NOT EXISTS 'Rental Agreement';
ALTER TYPE "receiptSourceDocument" ADD VALUE IF NOT EXISTS 'Rental Agreement';
