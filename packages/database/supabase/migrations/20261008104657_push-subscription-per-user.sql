-- A push subscription belongs to the browser and the user signed into it, not
-- to one company: the user gets the push of every company they are a member
-- of (notify drops recipients outside the notification's company), and a
-- company switch no longer silences the browser. "companyId" stays as the
-- company the user enabled it from (tenant attribution and the RLS check).

-- One row per endpoint: keep the most recently saved row of each browser.
DELETE FROM "pushSubscription" ps
USING "pushSubscription" newer
WHERE ps."endpoint" = newer."endpoint"
  AND (newer."updatedAt", newer."id") > (ps."updatedAt", ps."id");

ALTER TABLE "pushSubscription"
  DROP CONSTRAINT IF EXISTS "pushSubscription_endpoint_companyId_key";

ALTER TABLE "pushSubscription"
  ADD CONSTRAINT "pushSubscription_endpoint_key" UNIQUE ("endpoint");
