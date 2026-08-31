-- Simplify employee-ability qualification.
--
-- Qualification is now presence-based: an `employeeAbility` row means the person
-- is qualified for that ability, subject only to optional expiry
-- (`expiresAt` / `ability.recertifyEveryDays`). This drops:
--   * `active`           — a soft-delete flag; "Remove Employee" is now a hard delete
--   * `trainingCompleted`— the old gate; training is a path to a row, not a requirement
--   * `trainingDays`     — drove the dead "In Training" status; never written by any UI
--
-- The training-grant trigger keeps inserting the row on completion (with expiry),
-- it just no longer sets the two booleans.

-- 1. Redefine the grant trigger's function without the dropped columns.
CREATE OR REPLACE FUNCTION grant_ability_on_training_completion()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  granted_ability_id TEXT;
  recertify_days INTEGER;
  completed_date DATE;
BEGIN
  SELECT t."grantsAbilityId", a."recertifyEveryDays"
    INTO granted_ability_id, recertify_days
  FROM "trainingAssignment" ta
  JOIN "training" t ON t."id" = ta."trainingId"
  LEFT JOIN "ability" a ON a."id" = t."grantsAbilityId"
  WHERE ta."id" = NEW."trainingAssignmentId";

  IF granted_ability_id IS NULL THEN
    RETURN NEW;
  END IF;

  completed_date := COALESCE(NEW."completedAt"::date, CURRENT_DATE);

  INSERT INTO "employeeAbility"
    ("employeeId", "abilityId", "companyId", "lastTrainingDate", "expiresAt")
  VALUES (
    NEW."employeeId",
    granted_ability_id,
    NEW."companyId",
    completed_date,
    CASE WHEN recertify_days IS NOT NULL
      THEN completed_date + recertify_days
      ELSE NULL END
  )
  ON CONFLICT ("employeeId", "abilityId") DO UPDATE SET
    "lastTrainingDate" = EXCLUDED."lastTrainingDate",
    "expiresAt" = EXCLUDED."expiresAt";

  RETURN NEW;
END;
$$;

-- 2. Purge soft-deleted rows so they don't resurrect as qualified once `active`
--    is gone (guarded — the column may already be dropped on a re-run).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employeeAbility'
      AND column_name = 'active'
  ) THEN
    DELETE FROM "employeeAbility" WHERE "active" = false;
  END IF;
END $$;

-- 3. Drop the columns.
ALTER TABLE "employeeAbility" DROP COLUMN IF EXISTS "active";
ALTER TABLE "employeeAbility" DROP COLUMN IF EXISTS "trainingCompleted";
ALTER TABLE "employeeAbility" DROP COLUMN IF EXISTS "trainingDays";
