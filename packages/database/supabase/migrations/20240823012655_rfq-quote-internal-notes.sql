DROP VIEW "salesRfqs";

ALTER TABLE "salesRfq"
  DROP COLUMN "notes",
  ADD COLUMN "externalNotes" JSON DEFAULT '{}';


CREATE OR REPLACE VIEW "salesRfqs" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  rfq.*,
  l."name" AS "locationName",
  opp."quoteId",
  opp."salesOrderId",
  EXISTS(SELECT 1 FROM "salesRfqFavorite" rf WHERE rf."rfqId" = rfq.id AND rf."userId" = auth.uid()::text) AS favorite
  FROM "salesRfq" rfq
  LEFT JOIN "location" l
    ON l.id = rfq."locationId"
  LEFT JOIN "opportunity" opp
    ON opp."salesRfqId" = rfq.id;


DROP VIEW "quotes";

ALTER TABLE "quote"
  DROP COLUMN "notes",
  ADD COLUMN "externalNotes" JSON DEFAULT '{}',
  ADD COLUMN "internalNotes" JSON DEFAULT '{}';

CREATE OR REPLACE VIEW "quotes" WITH(SECURITY_INVOKER=true) AS
  SELECT 
  q.*,
  l."name" AS "locationName",
  ql."lines",
  ql."completedLines",
  EXISTS(SELECT 1 FROM "quoteFavorite" pf WHERE pf."quoteId" = q.id AND pf."userId" = auth.uid()::text) AS favorite,
  opp."salesRfqId",
  opp."salesOrderId"
  FROM "quote" q
  LEFT JOIN (
    SELECT 
      "quoteId",
      COUNT("id") AS "lines",
      COUNT("id") FILTER (WHERE "status" = 'Complete') AS "completedLines"
    FROM "quoteLine"
    GROUP BY "quoteId"
  ) ql ON ql."quoteId" = q.id
  LEFT JOIN "location" l
    ON l.id = q."locationId"
  LEFT JOIN "opportunity" opp
    ON opp."quoteId" = q.id;