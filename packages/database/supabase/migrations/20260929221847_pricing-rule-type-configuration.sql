-- A "Configuration" pricing rule targets one configurable item and carries only
-- per-parameter surcharges (pricingRule.configurationPrices) — no discount or
-- markup of its own (amount stays 0).
ALTER TYPE "pricingRuleType" ADD VALUE IF NOT EXISTS 'Configuration';
