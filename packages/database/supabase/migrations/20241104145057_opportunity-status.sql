ALTER TABLE "opportunity"
  ADD COLUMN "salesRfqCompletedDate" timestamp with time zone,
  ADD COLUMN "quoteCompletedDate" timestamp with time zone,
  ADD COLUMN "salesOrderCompletedDate" timestamp with time zone;


UPDATE opportunity o
SET "salesRfqCompletedDate" = COALESCE(sr."updatedAt", NOW())
FROM "salesRfq" sr
WHERE o."salesRfqId" = sr.id 
AND sr.status != 'Draft';

UPDATE opportunity o
SET "quoteCompletedDate" = COALESCE(q."updatedAt", NOW())
FROM "quote" q
WHERE o."quoteId" = q.id 
AND q.status != 'Draft';

UPDATE opportunity o
SET "salesOrderCompletedDate" = COALESCE(so."updatedAt", NOW())
FROM "salesOrder" so
WHERE o."salesOrderId" = so.id 
AND so.status != 'Draft';
