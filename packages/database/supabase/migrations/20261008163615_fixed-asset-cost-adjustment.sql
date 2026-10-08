-- A fixed asset's cost can be raised after it was capitalized: a unit made by
-- a job that recorded no production or material, or issued into stock at no
-- cost, enters the register at zero. `post-asset-transfer` `adjustCost` books
-- the value from an offset account the accountant chooses and records it as a
-- 'Cost Adjustment' transfer with source 'Manual'.
ALTER TYPE "fixedAssetTransferType" ADD VALUE IF NOT EXISTS 'Cost Adjustment';
ALTER TYPE "fixedAssetTransferSourceType" ADD VALUE IF NOT EXISTS 'Manual';
