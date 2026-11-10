-- Saves a Draft journal entry's header and line changes in one transaction.
--
-- saveJournalEntryWithLines (accounting.service.ts) works out the changes in
-- TypeScript (diffJournalLines) and hands them here, because the save must stay
-- callable through the Supabase client (the MCP tool, the opening-balance and
-- AR/AP adjust flows) and the client cannot open a transaction. Before this,
-- the save was six separate writes: a failure part-way left deleted lines
-- gone, or kept lines without their dimensions.
--
-- SECURITY INVOKER: every statement runs under the caller's RLS (the journal
-- line policies already require accounting_update / _create / _delete and a
-- Draft parent), and auth.uid() stays the caller, so the audit log credits
-- them.
--
-- The header update is the gate: it matches only a Draft journal of the given
-- company and locks it, so a save can never add lines to a posted entry (the
-- posted-immutability trigger guards UPDATE and DELETE on journalLine, not
-- INSERT) and a concurrent post waits for it. Every line write is pinned to
-- this journal and company, so ids in the payload cannot reach other rows.
--
-- p_lines: [{ op: "keep" | "update" | "insert", id?, accountId, description,
--             amount, dimensions: [{ dimensionId, valueId }], dimensionsChanged }]
-- Returns the line ids in p_lines order.
CREATE OR REPLACE FUNCTION public.save_journal_entry_lines(
  p_journal_id TEXT,
  p_company_id TEXT,
  p_user_id TEXT,
  p_posting_date DATE,
  p_lines JSONB,
  p_delete_ids TEXT[],
  p_description TEXT DEFAULT NULL
)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_line JSONB;
  v_id TEXT;
  v_ids TEXT[] := ARRAY[]::TEXT[];
BEGIN
  UPDATE "journal"
  SET
    "postingDate" = p_posting_date,
    -- NULL leaves the description as it is (a caller that omits it).
    "description" = COALESCE(p_description, "description"),
    "updatedBy" = p_user_id,
    "updatedAt" = NOW()
  WHERE "id" = p_journal_id
    AND "companyId" = p_company_id
    AND "status" = 'Draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry % is not a draft of this company', p_journal_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(array_length(p_delete_ids, 1), 0) > 0 THEN
    DELETE FROM "journalLine"
    WHERE "journalId" = p_journal_id
      AND "companyId" = p_company_id
      AND "id" = ANY(p_delete_ids);
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::JSONB))
  LOOP
    IF v_line->>'op' = 'insert' THEN
      -- clock_timestamp, not now(): lines inserted by one save keep their
      -- submitted order, which is the order the entry is read back in.
      INSERT INTO "journalLine" (
        "journalId", "accountId", "description", "amount",
        "journalLineReference", "companyId", "createdBy", "createdAt"
      )
      VALUES (
        p_journal_id,
        v_line->>'accountId',
        v_line->>'description',
        (v_line->>'amount')::NUMERIC,
        gen_random_uuid()::TEXT,
        p_company_id,
        p_user_id,
        clock_timestamp()
      )
      RETURNING "id" INTO v_id;
    ELSE
      v_id := v_line->>'id';

      IF v_line->>'op' = 'update' THEN
        UPDATE "journalLine"
        SET
          "accountId" = v_line->>'accountId',
          "description" = v_line->>'description',
          "amount" = (v_line->>'amount')::NUMERIC,
          "updatedBy" = p_user_id,
          "updatedAt" = NOW()
        WHERE "id" = v_id
          AND "journalId" = p_journal_id
          AND "companyId" = p_company_id;
      ELSE
        PERFORM 1 FROM "journalLine"
        WHERE "id" = v_id
          AND "journalId" = p_journal_id
          AND "companyId" = p_company_id;
      END IF;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Journal line % is not on journal entry %', v_id, p_journal_id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- Dimensions are rewritten only when they changed (deleting them needs
    -- accounting_delete, which an edit should not require otherwise).
    IF v_line->>'op' = 'insert' OR (v_line->>'dimensionsChanged')::BOOLEAN THEN
      IF v_line->>'op' <> 'insert' THEN
        DELETE FROM "journalLineDimension" WHERE "journalLineId" = v_id;
      END IF;

      INSERT INTO "journalLineDimension" ("journalLineId", "dimensionId", "valueId", "companyId")
      SELECT v_id, d->>'dimensionId', d->>'valueId', p_company_id
      FROM jsonb_array_elements(COALESCE(v_line->'dimensions', '[]'::JSONB)) AS d;
    END IF;

    v_ids := v_ids || v_id;
  END LOOP;

  RETURN v_ids;
END;
$$;
