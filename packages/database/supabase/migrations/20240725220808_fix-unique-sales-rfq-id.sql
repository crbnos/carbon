ALTER TABLE "salesRfq" DROP CONSTRAINT "salesRfq_rfqId_key";
DROP INDEX IF EXISTS "salesRfq_rfqId_idx";

ALTER TABLE "salesRfq" ADD CONSTRAINT "salesRfq_rfqId_key" UNIQUE ("rfqId", "companyId");