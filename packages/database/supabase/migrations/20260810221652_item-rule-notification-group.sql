-- Who gets notified when an item rule violation is blocked or acknowledged on
-- a quote / sales order line. Same shape as the sibling notification-group
-- settings (e.g. "supplierQuoteNotificationGroup").
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "itemRuleNotificationGroup" text[] NOT NULL DEFAULT '{}';
