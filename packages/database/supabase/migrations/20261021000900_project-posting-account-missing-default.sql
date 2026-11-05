-- project_posting_account returned NULL for a Statistical project AND for a missing
-- account default (or a missing project). Its callers (complete_job_to_inventory and
-- backflush_job_materials) read NULL as "Statistical", so a company that had not set
-- Project Expense or Project Work in Progress saw "consumes to a Statistical project".
--
-- Now NULL means Statistical only. A missing account default raises the same message
-- as resolveProjectPostingAccount (packages/server-functions/src/lib/project-posting.ts),
-- which this function mirrors, and a missing project raises too. The callers need no
-- change: their NULL branch is now true to its message.

CREATE OR REPLACE FUNCTION project_posting_account(
  p_company_id TEXT, p_project_id TEXT, p_element_id TEXT, p_posting_date DATE
) RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_treatment "projectCostTreatment";
  v_account TEXT;
  v_project RECORD;
  v_defaults RECORD;
BEGIN
  SELECT "costTreatment", "costAccountId" INTO v_project
  FROM "project" WHERE "id" = p_project_id AND "companyId" = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project % does not exist', p_project_id;
  END IF;

  -- nearest element (self, then ancestors) with a treatment effective on the date
  WITH RECURSIVE chain AS (
    SELECT e."id", e."parentId", e."costTreatment", e."costTreatmentEffectiveFrom", e."costAccountId", 0 AS depth
    FROM "projectElement" e WHERE e."id" = p_element_id AND e."companyId" = p_company_id
    UNION ALL
    SELECT p."id", p."parentId", p."costTreatment", p."costTreatmentEffectiveFrom", p."costAccountId", c.depth + 1
    FROM "projectElement" p JOIN chain c ON p."id" = c."parentId" AND p."companyId" = p_company_id
  )
  SELECT c."costTreatment", c."costAccountId" INTO v_treatment, v_account
  FROM chain c
  WHERE c."costTreatment" IS NOT NULL
    AND (c."costTreatmentEffectiveFrom" IS NULL OR c."costTreatmentEffectiveFrom" <= p_posting_date)
  ORDER BY c.depth LIMIT 1;

  IF v_treatment IS NULL THEN
    v_treatment := v_project."costTreatment";
    v_account := v_project."costAccountId";
  END IF;

  -- Statistical is the only treatment that returns NULL.
  IF v_treatment = 'Statistical' THEN RETURN NULL; END IF;
  IF v_account IS NOT NULL THEN RETURN v_account; END IF;

  SELECT "projectExpenseAccount", "projectWorkInProgressAccount" INTO v_defaults
  FROM "accountDefault" WHERE "companyId" = p_company_id;

  IF v_treatment = 'Expense' THEN
    IF v_defaults."projectExpenseAccount" IS NULL THEN
      RAISE EXCEPTION 'Set Project Expense in Account Defaults before you charge an Expense project';
    END IF;
    RETURN v_defaults."projectExpenseAccount";
  END IF;

  IF v_treatment = 'Contract' THEN
    IF v_defaults."projectWorkInProgressAccount" IS NULL THEN
      RAISE EXCEPTION 'Set Project Work in Progress in Account Defaults before you charge a Contract project';
    END IF;
    RETURN v_defaults."projectWorkInProgressAccount";
  END IF;

  RAISE EXCEPTION 'Cost treatment % is not available yet', v_treatment;
END;
$$;

NOTIFY pgrst, 'reload schema';
