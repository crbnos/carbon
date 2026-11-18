-- The receipt lines that are a job's cost had their rule written inside
-- job_wip_balance only, so the accounting cutover's per-job WIP items, which
-- read WIP lines by documentId, filed a job's outside processing receipts
-- under the item with no document. A job then opened with less WIP than it
-- held, and its completion and close missed that cost.
--
-- job_receipt_line_references is the one definition: a purchase order line is
-- the job's by its own jobId, else by its operation's (the operation link is
-- nulled when the operation is deleted). Its receipt's journal lines carry
-- 'receipt:' || the purchase order line in documentLineReference
-- (journalReference.to.receipt, packages/database/src/utils.ts).
-- job_wip_balance, getWorkInProgressItems
-- (packages/database/src/accounting-cutover/open-items.ts), and the job lock
-- and close check of an outside processing receipt (inventory and production
-- services) all read it.
--
-- A line whose own jobId and operation's job disagree now counts once, on its
-- own jobId; job_wip_balance counted it on both jobs.

-- SQL, STABLE, SECURITY INVOKER and no SET clause, so the planner inlines it
-- into job_wip_balance and filters by the job there.
CREATE OR REPLACE FUNCTION public.job_receipt_line_references(
  p_company_id text,
  p_job_id text DEFAULT NULL
)
 RETURNS TABLE (
   "jobId" text,
   "purchaseOrderLineId" text,
   "documentLineReference" text
 )
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    COALESCE(pol."jobId", jo."jobId") AS "jobId",
    pol.id AS "purchaseOrderLineId",
    'receipt:' || pol.id AS "documentLineReference"
  FROM public."purchaseOrderLine" pol
  LEFT JOIN public."jobOperation" jo
    ON jo.id = pol."jobOperationId"
   AND jo."companyId" = pol."companyId"
  WHERE pol."companyId" = p_company_id
    AND COALESCE(pol."jobId", jo."jobId") IS NOT NULL
    AND (p_job_id IS NULL OR COALESCE(pol."jobId", jo."jobId") = p_job_id);
$function$;

-- SECURITY INVOKER: from complete_job_to_inventory it runs as the owner, and
-- from the API under the caller's RLS.
CREATE OR REPLACE FUNCTION public.job_wip_balance(
  p_job_id text,
  p_company_id text,
  p_exclude_project_lines boolean DEFAULT false
)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(jl.amount), 0)
  FROM "journalLine" jl
  INNER JOIN "journal" j
    ON j.id = jl."journalId"
   AND j."companyId" = jl."companyId"
  WHERE jl."companyId" = p_company_id
    AND jl."accountId" = (
      SELECT ad."workInProgressAccount"
      FROM "accountDefault" ad
      WHERE ad."companyId" = p_company_id
    )
    -- DOCUMENT_JOURNAL_STATUSES (@carbon/database/accounting-posting).
    AND j.status IN ('Provisional', 'Posted', 'Reversed')
    AND (
      jl."documentId" = p_job_id
      OR jl."documentLineReference" = ANY (ARRAY(
        SELECT ref."documentLineReference"
        FROM job_receipt_line_references(p_company_id, p_job_id) ref
      ))
    )
    -- A line that charged a project in place of WIP is the project's cost.
    AND (
      NOT p_exclude_project_lines
      OR NOT EXISTS (
        SELECT 1
        FROM "projectLedger" pl
        WHERE pl."journalLineId" = jl.id
          AND pl."companyId" = p_company_id
      )
    );
$function$;
