ALTER TABLE "quote" ADD COLUMN "opportunityId" TEXT;

ALTER TABLE "quote" ADD CONSTRAINT "quote_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunity"("id") ON DELETE SET NULL;

ALTER TABLE "salesRfq" ADD COLUMN "opportunityId" TEXT;

ALTER TABLE "salesRfq" ADD CONSTRAINT "salesRfq_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunity"("id") ON DELETE SET NULL;

ALTER TABLE "salesOrder" ADD COLUMN "opportunityId" TEXT;

ALTER TABLE "salesOrder" ADD CONSTRAINT "salesOrder_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunity"("id") ON DELETE SET NULL;

