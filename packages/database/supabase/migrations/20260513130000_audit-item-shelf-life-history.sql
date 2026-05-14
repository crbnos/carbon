-- Ensure shelf-life policy changes are captured by the event/audit system.
-- 1) Attach event triggers for itemShelfLife.
-- 2) Backfill AUDIT subscriptions for already-audit-enabled companies.

SELECT attach_event_trigger('itemShelfLife', ARRAY[]::TEXT[], ARRAY[]::TEXT[]);

DO $$
DECLARE
  company_record RECORD;
BEGIN
  FOR company_record IN
    SELECT id FROM "company" WHERE "auditLogEnabled" = TRUE
  LOOP
    INSERT INTO "eventSystemSubscription" (
      "name",
      "table",
      "companyId",
      "operations",
      "handlerType",
      "config",
      "filter",
      "active"
    )
    VALUES (
      'audit-itemShelfLife',
      'itemShelfLife',
      company_record.id,
      ARRAY['INSERT', 'UPDATE', 'DELETE'],
      'AUDIT',
      '{}'::jsonb,
      '{}'::jsonb,
      TRUE
    )
    ON CONFLICT ON CONSTRAINT "unique_subscription_name_per_company"
    DO UPDATE SET
      "operations" = EXCLUDED."operations",
      "handlerType" = EXCLUDED."handlerType",
      "config" = EXCLUDED."config",
      "filter" = EXCLUDED."filter",
      "active" = EXCLUDED."active";
  END LOOP;
END;
$$;
