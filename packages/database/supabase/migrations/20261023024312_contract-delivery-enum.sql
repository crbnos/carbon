-- Contract deliveries (.ai/specs/2026-10-21-project-contracts.md, section 10.4):
-- a shipment that delivers a project contract's part CLINs.
-- Enum only: an ADD VALUE cannot share a transaction with statements that use it.
ALTER TYPE "shipmentSourceDocument" ADD VALUE IF NOT EXISTS 'Customer Contract';
