-- Master records (supplier, customer) can now own documents. Every existing
-- documentSourceType value is a transaction or an item; these are the first
-- two master-record sources.
ALTER TYPE "documentSourceType" ADD VALUE IF NOT EXISTS 'Supplier';
ALTER TYPE "documentSourceType" ADD VALUE IF NOT EXISTS 'Customer';
