-- Allow persisted provenance rows to survive when the readable item label is unavailable.
ALTER TABLE "public"."changeOrderImpactDecisionAffectedItem"
  ALTER COLUMN "affectedItemLabel" DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
