-- Keep the submitted request when staff remove its draft RFQ.
SET lock_timeout = '5s';

ALTER TABLE "customerPortalSubmission"
  DROP CONSTRAINT "customerPortalSubmission_salesRfqId_fkey",
  ADD CONSTRAINT "customerPortalSubmission_salesRfqId_fkey"
    FOREIGN KEY ("salesRfqId") REFERENCES "salesRfq"("id") ON DELETE SET NULL;

RESET lock_timeout;
