-- Successful-delivery counter for recurring notifications (weekly
-- TrainingReminder digest): written only by the send-email function after the
-- provider accepts a send, read by the weekly builder to stop re-sending after
-- MAX_NOTIFICATION_DELIVERIES. documentId carries the recurrence period
-- ("ta_1:2026") so each period gets a fresh budget. System-owned like
-- "notification" (single xid() PK, no audit columns).

CREATE TABLE "notificationDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT xid(),
  "companyId" TEXT NOT NULL REFERENCES "company"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "event" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "successCount" INTEGER NOT NULL DEFAULT 0,
  -- Provider id of the email behind the latest increment (retry dedupe).
  "lastDeliveryId" TEXT,
  "lastDeliveredAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX "notificationDelivery_company_user_event_document_key"
  ON "notificationDelivery" ("companyId", "userId", "event", "documentId");

CREATE INDEX "notificationDelivery_userId_idx" ON "notificationDelivery" ("userId");

ALTER TABLE "notificationDelivery" ENABLE ROW LEVEL SECURITY;

-- Writes come only from service-role jobs (bypass RLS) — no write policies.
CREATE POLICY "SELECT" ON "public"."notificationDelivery"
FOR SELECT USING (
  "userId" = auth.uid()::text
);

-- Atomic increment for every document delivered in one email. SECURITY INVOKER
-- (default): regular callers have no write policy, so only service role works.
-- p_delivery_id is the provider's email id, memoized across Inngest step
-- retries — a re-presented id keeps the count unchanged (no double-count).
DROP FUNCTION IF EXISTS increment_notification_delivery(TEXT, TEXT, TEXT, TEXT[]);

CREATE OR REPLACE FUNCTION increment_notification_delivery(
  p_company_id TEXT,
  p_user_id TEXT,
  p_event TEXT,
  p_document_ids TEXT[],
  p_delivery_id TEXT
) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO "notificationDelivery" ("companyId", "userId", "event", "documentId", "successCount", "lastDeliveryId", "lastDeliveredAt")
  SELECT p_company_id, p_user_id, p_event, unnest(p_document_ids), 1, p_delivery_id, NOW()
  ON CONFLICT ("companyId", "userId", "event", "documentId")
  DO UPDATE SET
    -- Plain "=" so a NULL id falls through to +1 rather than never counting.
    "successCount" = CASE
      WHEN "notificationDelivery"."lastDeliveryId" = excluded."lastDeliveryId"
      THEN "notificationDelivery"."successCount"
      ELSE "notificationDelivery"."successCount" + 1
    END,
    "lastDeliveryId" = excluded."lastDeliveryId",
    "lastDeliveredAt" = NOW();
$$;
