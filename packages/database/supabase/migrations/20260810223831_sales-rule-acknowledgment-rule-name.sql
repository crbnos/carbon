-- Evidence rows must stay meaningful after a rule is renamed or deleted:
-- denormalize the rule name at write time. "ruleId" remains a deliberate soft
-- reference (no FK) so evidence can neither be cascaded away by a rule delete
-- nor block one; deactivation ("active" = false) is the recommended lifecycle
-- for retiring rules that have fired.
ALTER TABLE "salesRuleAcknowledgment" ADD COLUMN IF NOT EXISTS "ruleName" TEXT;
