-- Who gets notified when a sales rule violation is blocked or acknowledged on
-- a quote / sales order line. Same shape as the sibling notification-group
-- settings (e.g. "supplierQuoteNotificationGroup").
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "salesRuleNotificationGroup" text[] NOT NULL DEFAULT '{}';
