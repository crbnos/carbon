-- Remove the change-order-level effective date. Cutover timing is now driven
-- entirely per affected item via itemSupersession's successorEffectivityDate /
-- discontinuationDate (an empty date = effective immediately at release). The
-- header default was an extra concept for users to learn with no real benefit
-- over the per-item dates.
ALTER TABLE "changeOrder" DROP COLUMN IF EXISTS "effectiveDate";
