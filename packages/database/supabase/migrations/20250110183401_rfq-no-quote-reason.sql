ALTER TABLE "salesRfq"
ADD COLUMN "noQuoteReasonId" TEXT REFERENCES "noQuoteReason"("id");
