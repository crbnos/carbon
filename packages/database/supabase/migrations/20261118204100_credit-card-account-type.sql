-- A credit card is a liability a supplier payment can be paid from. Its own
-- file: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "accountType" ADD VALUE IF NOT EXISTS 'Credit Card' AFTER 'Other Current Liability';
