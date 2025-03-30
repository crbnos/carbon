ALTER TYPE "purchaseOrderType" ADD VALUE 'Outside Processing';

ALTER TABLE "purchaseOrder" ADD COLUMN "purchaseOrderType" "purchaseOrderType" NOT NULL DEFAULT 'Purchase';