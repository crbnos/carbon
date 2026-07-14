-- Add an optional employee filter to get_training_assignment_status so
-- per-employee callers (e.g. the notify function resolving a TrainingReminder
-- digest) don't force a company-wide computation per call. Passing NULL (or
-- omitting the arg) preserves the existing company-wide behavior.
--
-- The old single-arg signature must be dropped first: CREATE OR REPLACE with a
-- different arg list would create an overload, and PostgREST rejects rpc calls
-- that match more than one candidate (the new arg is defaulted, so a
-- p_company_id-only call would match both).
DROP FUNCTION IF EXISTS get_training_assignment_status(TEXT);

CREATE OR REPLACE FUNCTION get_training_assignment_status(
  p_company_id TEXT,
  p_employee_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  "trainingAssignmentId" TEXT,
  "trainingId" TEXT,
  "trainingName" TEXT,
  frequency "trainingFrequency",
  "trainingType" "trainingType",
  "employeeId" TEXT,
  "employeeName" TEXT,
  "avatarUrl" TEXT,
  "employeeStartDate" DATE,
  "companyId" TEXT,
  "currentPeriod" TEXT,
  "completionId" INTEGER,
  "completedAt" TIMESTAMP WITH TIME ZONE,
  status TEXT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  WITH group_users AS (
    -- Get distinct users from all training assignment groups for this company
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
      t."name" AS "trainingName",
      t."frequency",
      t."type" AS "trainingType",
      u.id AS "employeeId",
      u."fullName" AS "employeeName",
      u."avatarUrl" AS "avatarUrl",
      ej."startDate" AS "employeeStartDate",
      ta."companyId" AS "companyId"
    FROM "trainingAssignment" ta
    JOIN "training" t ON t.id = ta."trainingId" AND t."status" = 'Active'
    JOIN group_users gu ON gu.assignment_id = ta.id
    JOIN "user" u ON u.id = gu.user_id AND u.active = TRUE
    JOIN "employee" e ON e.id = u.id AND e."companyId" = ta."companyId"
    LEFT JOIN "employeeJob" ej ON ej.id = u.id AND ej."companyId" = ta."companyId"
    WHERE ta."companyId" = p_company_id
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
    wp."employeeId",
    wp."employeeName",
    wp."avatarUrl",
    wp."employeeStartDate",
    wp."companyId",
    wp."currentPeriod",
    tc.id AS "completionId",
    tc."completedAt" AS "completedAt",
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
$$;
