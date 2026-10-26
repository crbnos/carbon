-- The changelog newsletter is one email per person, not per company, so its
-- preference becomes one row per user with "companyId" NULL. Before this every
-- company held its own row: turning the newsletter off in one company left it
-- on in another, and the dispatcher mailed anyone with any enabled row.
-- Every other topic stays per company.
--
-- Which topics are account-level is decided in one place, the app's
-- getNotificationTopicScope (@carbon/notifications), not by a CHECK here, so a
-- later account-level topic needs no schema change: a row stored under the
-- wrong scope (a per-company newsletter row from an older backup) is never read.

ALTER TABLE "notificationPreference" ALTER COLUMN "companyId" DROP NOT NULL;

-- NULLS NOT DISTINCT, so a user has at most one account-level row per
-- (channel, topic); the upsert's ON CONFLICT relies on it. Replaced only while
-- the constraint is still the old one, and dropped and added in one block, so
-- a retry over committed partial state neither fails nor leaves the table
-- without it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_index i ON i.indexrelid = c.conindid
    WHERE c.conrelid = 'public."notificationPreference"'::regclass
      AND c.conname = 'notificationPreference_userId_companyId_channel_topic_key'
      AND i.indnullsnotdistinct
  ) THEN
    ALTER TABLE "notificationPreference"
      DROP CONSTRAINT IF EXISTS "notificationPreference_userId_companyId_channel_topic_key";
    ALTER TABLE "notificationPreference"
      ADD CONSTRAINT "notificationPreference_userId_companyId_channel_topic_key"
      UNIQUE NULLS NOT DISTINCT ("userId", "companyId", "channel", "topic");
  END IF;
END
$$;

-- Each user keeps the switch they flipped last, from whichever company. An
-- account-level row already there (a retry, or a toggle since) is kept.
INSERT INTO "notificationPreference" ("userId", "companyId", "channel", "topic", "enabled", "updatedAt")
SELECT DISTINCT ON ("userId", "channel")
  "userId", NULL, "channel", "topic", "enabled", "updatedAt"
FROM "notificationPreference"
WHERE "topic" = 'changelog' AND "companyId" IS NOT NULL
ORDER BY "userId", "channel", "updatedAt" DESC, "id" DESC
ON CONFLICT ON CONSTRAINT "notificationPreference_userId_companyId_channel_topic_key" DO NOTHING;

DELETE FROM "notificationPreference"
WHERE "topic" = 'changelog' AND "companyId" IS NOT NULL;
