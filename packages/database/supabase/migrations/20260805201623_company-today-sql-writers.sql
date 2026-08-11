-- Business dates derived in SQL must use the business calendar, not the
-- database's. `company_today()` landed in 20260805023439; this migration adds
-- the location counterpart and converts the four remaining SQL functions that
-- WRITE or ANCHOR a business date off `CURRENT_DATE` (= UTC).
--
-- Read-only "is it overdue?" surfaces (gauges, purchaseInvoices, salesInvoices,
-- training periods, planning discontinuation filters) still compare against
-- CURRENT_DATE. They render a status rather than storing one, so a one-day skew
-- is cosmetic; converting them is a separate change.

-- Operational sibling of company_today(): a physical site's calendar day, for
-- expiry and scheduling. Falls back to the company timezone, then UTC — the
-- same precedence as getLocationTimeZone() in the app.
--
-- SECURITY INVOKER (like company_today), deliberately: every caller today is
-- either SECURITY DEFINER (get_next_sequence, set_shelf_life_for_operation) or
-- runs service-role (edge functions), so the timezone rows are always readable.
-- Under an RLS denial these would silently fall back to UTC — keep new callers
-- privileged. Do NOT flip these to SECURITY DEFINER: public definer functions
-- are auto-exposed as PostgREST RPCs, and that would hand any authenticated
-- user a cross-tenant "what is company X's local date" probe.
CREATE OR REPLACE FUNCTION public.location_today(
  p_location_id TEXT,
  p_company_id TEXT
)
RETURNS date
LANGUAGE sql
STABLE
AS $function$
  SELECT (now() AT TIME ZONE COALESCE(
    (
      SELECT "timezone" FROM public."location"
      WHERE "id" = p_location_id AND "companyId" = p_company_id
    ),
    (SELECT "timezone" FROM public."company" WHERE "id" = p_company_id),
    'UTC'
  ))::date
$function$;

-- 1. get_next_sequence — every ERP document number flows through here. The
--    date tokens were interpolated off the UTC day while the TypeScript twin
--    (interpolateSequenceDate) used the company timezone, so the two numbering
--    paths disagreed. Also adds %{ww}/%{hh}/%{ss}, which the Sequences settings
--    UI advertises but this function emitted literally.
CREATE OR REPLACE FUNCTION public.get_next_sequence(sequence_name text, company_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prefix text;
  v_suffix text;
  v_next_value integer;
  v_size integer;
  v_next_sequence text;
  v_derived_prefix text;
  v_derived_suffix text;
  v_now timestamp;
BEGIN
  IF session_user = 'authenticator' THEN
    IF NOT (has_role('employee', company_id) OR has_valid_api_key_for_company(company_id)) THEN
      RAISE EXCEPTION 'Insufficient permissions';
    END IF;
  END IF;

  UPDATE sequence
  SET next = next + step,
      "updatedBy" = 'system'
  WHERE "table" = sequence_name
  AND "companyId" = company_id
  RETURNING next, prefix, suffix, size
  INTO v_next_value, v_prefix, v_suffix, v_size;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sequence not found for table % and company %', sequence_name, company_id;
  END IF;

  -- Format sequence number
  v_next_sequence := lpad(v_next_value::text, COALESCE(v_size, 4), '0');

  -- Wall-clock in the company's timezone: document prefixes must roll over at
  -- the company's midnight, not the database's. Matches the TypeScript twin
  -- interpolateSequenceDate(value, companyTimezone).
  v_now := now() AT TIME ZONE COALESCE(
    (SELECT "timezone" FROM "company" WHERE "id" = company_id),
    'UTC'
  );

  -- Interpolate date variables in prefix/suffix
  v_derived_prefix := COALESCE(v_prefix, '');
  v_derived_prefix := replace(v_derived_prefix, '%{yyyy}', to_char(v_now, 'YYYY'));
  v_derived_prefix := replace(v_derived_prefix, '%{yy}', to_char(v_now, 'YY'));
  v_derived_prefix := replace(v_derived_prefix, '%{mm}', to_char(v_now, 'MM'));
  v_derived_prefix := replace(v_derived_prefix, '%{ww}', to_char(v_now, 'IW'));
  v_derived_prefix := replace(v_derived_prefix, '%{dd}', to_char(v_now, 'DD'));
  v_derived_prefix := replace(v_derived_prefix, '%{hh}', to_char(v_now, 'HH24'));
  v_derived_prefix := replace(v_derived_prefix, '%{ss}', to_char(v_now, 'SS'));

  v_derived_suffix := COALESCE(v_suffix, '');
  v_derived_suffix := replace(v_derived_suffix, '%{yyyy}', to_char(v_now, 'YYYY'));
  v_derived_suffix := replace(v_derived_suffix, '%{yy}', to_char(v_now, 'YY'));
  v_derived_suffix := replace(v_derived_suffix, '%{mm}', to_char(v_now, 'MM'));
  v_derived_suffix := replace(v_derived_suffix, '%{ww}', to_char(v_now, 'IW'));
  v_derived_suffix := replace(v_derived_suffix, '%{dd}', to_char(v_now, 'DD'));
  v_derived_suffix := replace(v_derived_suffix, '%{hh}', to_char(v_now, 'HH24'));
  v_derived_suffix := replace(v_derived_suffix, '%{ss}', to_char(v_now, 'SS'));

  RETURN v_derived_prefix || v_next_sequence || v_derived_suffix;
END;
$function$;

-- 2. generateEliminationEntries — the elimination journal's postingDate is a
--    ledger date and must derive on the elimination entity's calendar.
CREATE OR REPLACE FUNCTION public."generateEliminationEntries"(p_company_group_id text, p_user_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rec RECORD;
  v_lca_id TEXT;
  v_elim_id TEXT;
  v_journal_id INTEGER;
  v_period_id TEXT;
  v_journals_created INTEGER := 0;
  v_posting_date DATE;
  v_journals_by_elim RECORD;
BEGIN
  -- Check that user belongs to at least one company in this group
  IF NOT EXISTS (
    SELECT 1
    FROM "userToCompany" utc
    INNER JOIN "company" c ON c."id" = utc."companyId"
    WHERE utc."userId" = auth.uid()::text
      AND utc."role" = 'employee'
      AND c."companyGroupId" = p_company_group_id
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to generate elimination entries';
  END IF;

  -- Process each matched IC transaction pair, routing to the correct elimination entity
  -- Group matched transactions by their lowest common parent's elimination entity
  FOR v_rec IN
    SELECT DISTINCT
      ict."sourceCompanyId",
      ict."targetCompanyId"
    FROM "intercompanyTransaction" ict
    WHERE ict."companyGroupId" = p_company_group_id
      AND ict."status" = 'Matched'
  LOOP
    -- Find the lowest common parent
    v_lca_id := "findLowestCommonParent"(v_rec."sourceCompanyId", v_rec."targetCompanyId");

    -- Find the elimination entity for this LCA
    SELECT c."id" INTO v_elim_id
    FROM "company" c
    WHERE c."parentCompanyId" = v_lca_id
      AND c."isEliminationEntity" = true
      AND c."companyGroupId" = p_company_group_id
    LIMIT 1;

    -- If no elimination entity at the LCA level, fall back to any in the group
    IF v_elim_id IS NULL THEN
      SELECT c."id" INTO v_elim_id
      FROM "company" c
      WHERE c."companyGroupId" = p_company_group_id
        AND c."isEliminationEntity" = true
      LIMIT 1;
    END IF;

    IF v_elim_id IS NULL THEN
      RAISE EXCEPTION 'No elimination entity found for company group %', p_company_group_id;
    END IF;

    -- The journal posts on company_today(v_elim_id), so resolve the period
    -- CONTAINING that date — an Active flag alone can point at a different
    -- month and split the journal from its posting date. Fall back to the
    -- Active period only when no period covers the date (calendar not yet
    -- generated), preserving the pre-timezone behavior.
    v_posting_date := company_today(v_elim_id);

    SELECT "id" INTO v_period_id
    FROM "accountingPeriod"
    WHERE "companyId" = v_elim_id
      AND "startDate" <= v_posting_date
      AND "endDate" >= v_posting_date
    LIMIT 1;

    IF v_period_id IS NULL THEN
      SELECT "id" INTO v_period_id
      FROM "accountingPeriod"
      WHERE "companyId" = v_elim_id
        AND "status" = 'Active'
      LIMIT 1;
    END IF;

    -- Create elimination journal on this elimination entity
    INSERT INTO "journal" ("description", "accountingPeriodId", "companyId", "postingDate")
    VALUES (
      'IC Elimination: ' || v_rec."sourceCompanyId" || ' ↔ ' || v_rec."targetCompanyId",
      v_period_id,
      v_elim_id,
      -- Ledger date: the elimination entity's calendar, not the database's.
      v_posting_date
    )
    RETURNING "id" INTO v_journal_id;

    v_journals_created := v_journals_created + 1;

    -- Generate reversing entries from source journal lines
    INSERT INTO "journalLine" (
      "journalId", "accountId", "description", "amount",
      "documentType", "journalLineReference",
      "companyId", "companyGroupId"
    )
    SELECT
      v_journal_id,
      jl."accountId",
      'IC Elimination: ' || COALESCE(jl."description", ''),
      -jl."amount",
      jl."documentType",
      'ic-elim-' || ict."id",
      v_elim_id,
      p_company_group_id
    FROM "intercompanyTransaction" ict
    INNER JOIN "journalLine" jl ON jl."id" = ict."sourceJournalLineId"
    WHERE ict."companyGroupId" = p_company_group_id
      AND ict."status" = 'Matched'
      AND ict."sourceCompanyId" = v_rec."sourceCompanyId"
      AND ict."targetCompanyId" = v_rec."targetCompanyId";

    -- Also reverse the matched counterpart entries
    INSERT INTO "journalLine" (
      "journalId", "accountId", "description", "amount",
      "documentType", "journalLineReference",
      "companyId", "companyGroupId"
    )
    SELECT
      v_journal_id,
      jl."accountId",
      'IC Elimination: ' || COALESCE(jl."description", ''),
      -jl."amount",
      jl."documentType",
      'ic-elim-' || ict."id",
      v_elim_id,
      p_company_group_id
    FROM "intercompanyTransaction" ict
    INNER JOIN "journalLine" jl ON jl."id" = ict."targetJournalLineId"
    WHERE ict."companyGroupId" = p_company_group_id
      AND ict."status" = 'Matched'
      AND ict."sourceCompanyId" = v_rec."sourceCompanyId"
      AND ict."targetCompanyId" = v_rec."targetCompanyId"
      AND ict."targetJournalLineId" IS NOT NULL;

    -- Update these IC transactions to Eliminated
    UPDATE "intercompanyTransaction"
    SET "status" = 'Eliminated',
        "eliminationJournalId" = v_journal_id,
        "updatedAt" = NOW()
    WHERE "companyGroupId" = p_company_group_id
      AND "status" = 'Matched'
      AND "sourceCompanyId" = v_rec."sourceCompanyId"
      AND "targetCompanyId" = v_rec."targetCompanyId";

  END LOOP;

  RETURN v_journals_created;
END;
$function$;

-- 3. set_shelf_life_for_operation — writes trackedEntity."expirationDate".
--    Shelf life is operational, so it counts from the producing plant's day.
CREATE OR REPLACE FUNCTION public.set_shelf_life_for_operation(p_job_operation_id text, p_event "shelfLifeTriggerTiming")
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_job_id                       TEXT;
  v_job_make_method_id           TEXT;
  v_operation_process_id         TEXT;
  v_item_id                      TEXT;
  v_company_id                   TEXT;
  v_location_id                  TEXT;
  v_shelf_life_mode              "shelfLifeMode";
  v_shelf_life_days              NUMERIC;
  v_shelf_life_trigger_process   TEXT;
  v_shelf_life_trigger_timing    "shelfLifeTriggerTiming";
  v_calc_from_bom                BOOLEAN;
  v_input_scope                  TEXT;
  v_computed_expiry              DATE;
  v_input_min                    DATE;
BEGIN
  SELECT
    jo."jobId",
    jo."jobMakeMethodId",
    jo."processId",
    jmm."itemId",
    i."companyId",
    j."locationId"
  INTO
    v_job_id,
    v_job_make_method_id,
    v_operation_process_id,
    v_item_id,
    v_company_id,
    v_location_id
  FROM "jobOperation" jo
  JOIN "jobMakeMethod" jmm ON jmm."id" = jo."jobMakeMethodId"
  JOIN "item"          i  ON i."id"  = jmm."itemId"
  LEFT JOIN "job"      j  ON j."id"  = jo."jobId"
  WHERE jo."id" = p_job_operation_id;

  IF v_item_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    "mode", "days", "triggerProcessId", "triggerTiming",
    "calculateFromBom"
  INTO
    v_shelf_life_mode, v_shelf_life_days, v_shelf_life_trigger_process,
    v_shelf_life_trigger_timing, v_calc_from_bom
  FROM "itemShelfLife"
  WHERE "itemId" = v_item_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_shelf_life_mode = 'Fixed Duration' THEN
    IF v_shelf_life_days IS NULL THEN
      RETURN;
    END IF;

    IF v_shelf_life_trigger_process IS NULL THEN
      IF p_event <> 'After' THEN
        RETURN;
      END IF;
    ELSE
      IF v_operation_process_id IS DISTINCT FROM v_shelf_life_trigger_process THEN
        RETURN;
      END IF;
      IF p_event <> v_shelf_life_trigger_timing THEN
        RETURN;
      END IF;
    END IF;

    -- Shelf life counts from the producing plant's day, not the database's.
    v_computed_expiry := (
      location_today(v_location_id, v_company_id)
      + (v_shelf_life_days || ' days')::INTERVAL
    )::DATE;

    -- Cap by earliest input expiry when the flag is on.
    IF v_calc_from_bom THEN
      SELECT COALESCE(
        "inventoryShelfLife"->>'calculatedInputScope',
        'AllInputs'
      )
      INTO v_input_scope
      FROM "companySettings"
      WHERE "id" = v_company_id;

      IF v_input_scope IS NULL THEN
        v_input_scope := 'AllInputs';
      END IF;

      IF v_input_scope = 'AllInputs' THEN
        SELECT MIN(te."expirationDate")
        INTO v_input_min
        FROM "trackedActivityInput" tai
        JOIN "trackedActivity" ta ON ta."id" = tai."trackedActivityId"
        JOIN "trackedEntity"   te ON te."id" = tai."trackedEntityId"
        WHERE ta.attributes->>'Job Make Method' = v_job_make_method_id
          AND te."expirationDate" IS NOT NULL;
      ELSE
        SELECT MIN(te."expirationDate")
        INTO v_input_min
        FROM "trackedActivityInput" tai
        JOIN "trackedActivity" ta  ON ta."id"      = tai."trackedActivityId"
        JOIN "trackedEntity"   te  ON te."id"      = tai."trackedEntityId"
        JOIN "itemShelfLife"   isl ON isl."itemId" = te."sourceDocumentId"
        WHERE ta.attributes->>'Job Make Method' = v_job_make_method_id
          AND isl."mode" IN ('Fixed Duration', 'Calculated')
          AND te."expirationDate" IS NOT NULL;
      END IF;

      IF v_input_min IS NOT NULL AND v_input_min < v_computed_expiry THEN
        v_computed_expiry := v_input_min;
      END IF;
    END IF;

  ELSIF v_shelf_life_mode = 'Calculated' THEN
    IF p_event <> 'After' THEN
      RETURN;
    END IF;

    SELECT COALESCE(
      "inventoryShelfLife"->>'calculatedInputScope',
      'AllInputs'
    )
    INTO v_input_scope
    FROM "companySettings"
    WHERE "id" = v_company_id;

    IF v_input_scope IS NULL THEN
      v_input_scope := 'AllInputs';
    END IF;

    IF v_input_scope = 'AllInputs' THEN
      SELECT MIN(te."expirationDate")
      INTO v_computed_expiry
      FROM "trackedActivityInput" tai
      JOIN "trackedActivity" ta ON ta."id" = tai."trackedActivityId"
      JOIN "trackedEntity"   te ON te."id" = tai."trackedEntityId"
      WHERE ta.attributes->>'Job Make Method' = v_job_make_method_id
        AND te."expirationDate" IS NOT NULL;
    ELSE
      SELECT MIN(te."expirationDate")
      INTO v_computed_expiry
      FROM "trackedActivityInput" tai
      JOIN "trackedActivity" ta  ON ta."id"      = tai."trackedActivityId"
      JOIN "trackedEntity"   te  ON te."id"      = tai."trackedEntityId"
      JOIN "itemShelfLife"   isl ON isl."itemId" = te."sourceDocumentId"
      WHERE ta.attributes->>'Job Make Method' = v_job_make_method_id
        AND isl."mode" IN ('Fixed Duration', 'Calculated')
        AND te."expirationDate" IS NOT NULL;
    END IF;

    IF v_computed_expiry IS NULL THEN
      RETURN;
    END IF;

  ELSIF v_shelf_life_mode = 'Set on Receipt' THEN
    RETURN;

  ELSE
    RETURN;
  END IF;

  UPDATE "trackedEntity"
  SET "expirationDate" = v_computed_expiry
  WHERE "sourceDocument" = 'Item'
    AND "sourceDocumentId" = v_item_id
    AND "attributes"->>'Job Make Method' = v_job_make_method_id
    AND "expirationDate" IS NULL;
END;
$function$;

-- 4. resolve_shelf_life_start_for_receipt — the anchor falls back to "today"
--    when the receipt has no postingDate yet; that fallback is the receiving
--    site's day.
CREATE OR REPLACE FUNCTION public.resolve_shelf_life_start_for_receipt(p_item_id text, p_receipt_id text)
 RETURNS date
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_mode   "shelfLifeMode";
  v_days   NUMERIC;
  v_anchor DATE;
BEGIN
  SELECT "mode", "days" INTO v_mode, v_days
  FROM "itemShelfLife"
  WHERE "itemId" = p_item_id;

  IF NOT FOUND OR v_mode <> 'Fixed Duration' OR v_days IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE("postingDate", location_today("locationId", "companyId"))
  INTO v_anchor
  FROM "receipt"
  WHERE id = p_receipt_id;

  RETURN (v_anchor + (v_days || ' days')::INTERVAL)::DATE;
END;
$function$;
