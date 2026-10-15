-- An external training happens outside Carbon: the assignment carries only a
-- name, has no training, and is completed by an admin. It is one-time.
ALTER TABLE "trainingAssignment"
  ALTER COLUMN "trainingId" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "name" TEXT,
  DROP CONSTRAINT IF EXISTS "trainingAssignment_training_or_name";

ALTER TABLE "trainingAssignment"
  ADD CONSTRAINT "trainingAssignment_training_or_name"
    CHECK (num_nonnulls("trainingId", "name") = 1);

-- Both return types change, and the summary reads the status function.
DROP FUNCTION IF EXISTS public.get_training_assignment_summary(text);
DROP FUNCTION IF EXISTS public.get_training_assignment_status(text, text);

CREATE OR REPLACE FUNCTION public.get_training_assignment_status(p_company_id text, p_employee_id text DEFAULT NULL::text)
 RETURNS TABLE("trainingAssignmentId" text, "trainingId" text, "trainingName" text, frequency "trainingFrequency", "trainingType" "trainingType", "isExternal" boolean, "employeeId" text, "employeeName" text, "avatarUrl" text, "employeeStartDate" date, "companyId" text, "currentPeriod" text, "completionId" integer, "completedAt" timestamp with time zone, "certificatePath" text, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM assert_company_access(p_company_id);

  RETURN QUERY
  WITH group_users AS (
    SELECT DISTINCT
      ta.id AS assignment_id,
      jsonb_array_elements_text(users_for_groups(ta."groupIds")) AS user_id
    FROM "trainingAssignment" ta
    WHERE ta."companyId" = p_company_id
  ),
  assigned_employees AS (
    SELECT DISTINCT
      ta.id AS "trainingAssignmentId",
      ta."trainingId" AS "trainingId",
      COALESCE(t."name", ta."name") AS "trainingName",
      -- An external assignment is one-time.
      COALESCE(t."frequency", 'Once'::"trainingFrequency") AS "frequency",
      COALESCE(t."type", 'Mandatory'::"trainingType") AS "trainingType",
      (ta."trainingId" IS NULL) AS "isExternal",
      u.id AS "employeeId",
      u."fullName" AS "employeeName",
      u."avatarUrl" AS "avatarUrl",
      ej."startDate" AS "employeeStartDate",
      ta."companyId" AS "companyId"
    FROM "trainingAssignment" ta
    LEFT JOIN "training" t ON t.id = ta."trainingId"
    JOIN group_users gu ON gu.assignment_id = ta.id
    JOIN "user" u ON u.id = gu.user_id AND u.active = TRUE
    JOIN "employee" e ON e.id = u.id AND e."companyId" = ta."companyId"
    LEFT JOIN "employeeJob" ej ON ej.id = u.id AND ej."companyId" = ta."companyId"
    WHERE ta."companyId" = p_company_id
      AND (ta."trainingId" IS NULL OR t."status" = 'Active')
      AND (p_employee_id IS NULL OR u.id = p_employee_id)
  ),
  with_period AS (
    SELECT ae.*, get_current_training_period(ae."frequency") AS "currentPeriod"
    FROM assigned_employees ae
  )
  SELECT
    wp."trainingAssignmentId",
    wp."trainingId",
    wp."trainingName",
    wp."frequency",
    wp."trainingType",
    wp."isExternal",
    wp."employeeId",
    wp."employeeName",
    wp."avatarUrl",
    wp."employeeStartDate",
    wp."companyId",
    wp."currentPeriod",
    tc.id AS "completionId",
    tc."completedAt" AS "completedAt",
    tc."certificatePath" AS "certificatePath",
    CASE
      WHEN wp."frequency" = 'Once' THEN
        CASE WHEN tc.id IS NOT NULL THEN 'Completed' ELSE 'Pending' END
      WHEN tc.id IS NOT NULL THEN 'Completed'
      WHEN NOT employee_requires_period(wp."employeeStartDate", wp."currentPeriod") THEN 'Not Required'
      WHEN get_period_end_date(wp."currentPeriod") < CURRENT_DATE THEN 'Overdue'
      ELSE 'Pending'
    END AS status
  FROM with_period wp
  LEFT JOIN "trainingCompletion" tc ON
    tc."trainingAssignmentId" = wp."trainingAssignmentId"
    AND tc."employeeId" = wp."employeeId"
    AND ((wp."frequency" = 'Once' AND tc."period" IS NULL) OR tc."period" = wp."currentPeriod");
END;
$function$;

-- One row per assignment: an external assignment has no training to group by.
CREATE OR REPLACE FUNCTION public.get_training_assignment_summary(p_company_id text)
 RETURNS TABLE("trainingAssignmentId" text, "trainingId" text, "trainingName" text, frequency "trainingFrequency", "isExternal" boolean, "currentPeriod" text, "totalAssigned" bigint, completed bigint, pending bigint, overdue bigint, "completionPercent" numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM assert_company_access(p_company_id);

  RETURN QUERY
  SELECT
    tas."trainingAssignmentId",
    tas."trainingId",
    tas."trainingName",
    tas.frequency,
    tas."isExternal",
    tas."currentPeriod",
    COUNT(*) FILTER (WHERE tas.status != 'Not Required'),
    COUNT(*) FILTER (WHERE tas.status = 'Completed'),
    COUNT(*) FILTER (WHERE tas.status = 'Pending'),
    COUNT(*) FILTER (WHERE tas.status = 'Overdue'),
    CASE
      WHEN COUNT(*) FILTER (WHERE tas.status != 'Not Required') = 0 THEN 100
      ELSE ROUND(COUNT(*) FILTER (WHERE tas.status = 'Completed')::NUMERIC * 100 /
           NULLIF(COUNT(*) FILTER (WHERE tas.status != 'Not Required'), 0), 1)
    END
  FROM get_training_assignment_status(p_company_id) tas
  GROUP BY tas."trainingAssignmentId", tas."trainingId", tas."trainingName",
    tas.frequency, tas."isExternal", tas."currentPeriod";
END;
$function$;
