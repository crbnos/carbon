-- Add Customer, Supplier, and Item to the dimensionEntityType enum.
-- Enum-add only: Postgres will not allow a newly added enum value to be used
-- in the same transaction that adds it, so the backfill that references these
-- values lives in a separate, later migration.
ALTER TYPE "dimensionEntityType" ADD VALUE 'Customer';
ALTER TYPE "dimensionEntityType" ADD VALUE 'Supplier';
ALTER TYPE "dimensionEntityType" ADD VALUE 'Item';
