-- Projects Phase 1b: the Capitalize treatment in project_posting_account.
-- Mirrors resolveProjectPostingAccount (packages/server-functions/src/lib/project-posting.ts).
-- A Capitalize charge posts to the asset account of the asset it builds. That asset is
-- the element itself when it is a final asset, else its nearest final-asset ancestor,
-- else the project's own asset. An Under Construction asset gives its CIP class account;
-- an Active asset (a late cost) gives its in-service class account. Any other case raises.
-- The explicit costAccountId is ignored for Capitalize, as in the TS resolver.
-- The other treatments are unchanged from 20261021000900.

CREATE OR REPLACE FUNCTION project_posting_account(
  p_company_id TEXT, p_project_id TEXT, p_element_id TEXT, p_posting_date DATE
) RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_treatment "projectCostTreatment";
  v_account TEXT;
  v_project RECORD;
  v_defaults RECORD;
  v_asset_id TEXT;
  v_final_asset_id TEXT;
  v_asset RECORD;
BEGIN
  SELECT "costTreatment", "costAccountId", "fixedAssetId" INTO v_project
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

  IF v_treatment = 'Capitalize' THEN
    -- nearest final-asset element (self, then ancestors), else the project's asset.
    -- A final-asset element with no asset yet holds none: the raise below runs.
    v_asset_id := v_project."fixedAssetId";
    IF p_element_id IS NOT NULL THEN
      WITH RECURSIVE chain AS (
        SELECT e."id", e."parentId", e."isFinalAsset", e."fixedAssetId", 0 AS depth
        FROM "projectElement" e WHERE e."id" = p_element_id AND e."companyId" = p_company_id
        UNION ALL
        SELECT p."id", p."parentId", p."isFinalAsset", p."fixedAssetId", c.depth + 1
        FROM "projectElement" p JOIN chain c ON p."id" = c."parentId" AND p."companyId" = p_company_id
      )
      SELECT c."fixedAssetId" INTO v_final_asset_id
      FROM chain c WHERE c."isFinalAsset" ORDER BY c.depth LIMIT 1;
      IF FOUND THEN v_asset_id := v_final_asset_id; END IF;
    END IF;

    SELECT fa."status", fc."assetAccountId" INTO v_asset
    FROM "fixedAsset" fa
    JOIN "fixedAssetClass" fc ON fc."id" = fa."fixedAssetClassId"
    WHERE fa."id" = v_asset_id AND fa."companyId" = p_company_id;

    IF FOUND AND v_asset."status" IN ('Under Construction', 'Active') THEN
      RETURN v_asset."assetAccountId";
    END IF;
    RAISE EXCEPTION 'This capital project has no asset under construction. Release the project first.';
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
