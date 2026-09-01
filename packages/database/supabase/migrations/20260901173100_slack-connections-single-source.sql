-- Slack's credential and workspace facts move to integrationConnection (piece
-- 'slack'), the same home Google Calendar already uses; companyIntegration.slack
-- becomes the installed flag alone. One connection per previously installed
-- company, token moved vault→vault, plaintext facts stripped. Idempotent: a company
-- that already has a slack connection is skipped, and a stripped row strips to the
-- same thing again.
--
-- Robustness rules, in order:
--   * integrationConnection.createdBy/updatedBy REFERENCE "user"; companyIntegration
--     .updatedBy is bare text. Only a user id that still exists is used; otherwise the
--     company's first member; otherwise the company is skipped with a NOTICE and its
--     plaintext left untouched (nothing is deleted that cannot be recreated).
--   * The vault is read BEFORE the row is written. No token → the connection is
--     inserted 'Expired' with a lastError, so the card says "reconnect" instead of
--     an Active row whose secret read throws forever.
--   * An inactive install becomes a 'Revoked' row and gets NO secret — a Revoked row
--     never holds a token (disconnectConnection's invariant).
--   * The incoming-webhook URL is a bearer capability; it is not copied anywhere.

CREATE INDEX IF NOT EXISTS "integrationConnection_slack_team_idx"
  ON "integrationConnection" ("pieceName", ("metadata"->>'team_id'))
  WHERE "pieceName" = 'slack';

CREATE OR REPLACE FUNCTION _backfill_slack_connection(p_company_id text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_row "companyIntegration"%ROWTYPE;
  v_meta jsonb;
  v_bag jsonb;
  v_token text;
  v_id text;
  v_actor text;
  v_status text;
BEGIN
  SELECT * INTO v_row FROM "companyIntegration"
    WHERE "companyId" = p_company_id AND id = 'slack';
  IF NOT FOUND THEN RETURN; END IF;
  v_meta := v_row.metadata::jsonb;

  IF v_meta->>'team_id' IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "integrationConnection"
      WHERE "companyId" = p_company_id AND "pieceName" = 'slack'
  ) THEN
    SELECT id INTO v_actor FROM "user" WHERE id = v_row."updatedBy";
    IF v_actor IS NULL THEN
      SELECT "userId" INTO v_actor FROM "userToCompany"
        WHERE "companyId" = p_company_id ORDER BY "userId" LIMIT 1;
    END IF;
    IF v_actor IS NULL THEN
      RAISE NOTICE 'slack backfill: company % has no member to own the connection; left untouched', p_company_id;
      RETURN;
    END IF;

    v_bag := get_integration_secret(p_company_id, 'slack');
    v_token := CASE WHEN v_bag IS NOT NULL AND v_bag ? 'access_token'
                    THEN v_bag->>'access_token' END;
    IF v_token = '' THEN v_token := NULL; END IF;

    v_status := CASE
      WHEN NOT v_row.active THEN 'Revoked'
      WHEN v_token IS NULL THEN 'Expired'
      ELSE 'Active'
    END;

    INSERT INTO "integrationConnection"
      ("companyId", "pieceName", "name", "authType", "accountLabel", "metadata",
       "expiresAt", "status", "lastError", "createdBy", "updatedBy")
    VALUES (
      p_company_id, 'slack', coalesce(v_meta->>'team_name', 'Slack'), 'OAUTH2',
      v_meta->>'team_name',
      jsonb_strip_nulls(jsonb_build_object(
        'team_id', v_meta->'team_id',
        'team_name', v_meta->'team_name',
        'bot_user_id', v_meta->'bot_user_id',
        'channel', v_meta->'channel',
        'channel_id', v_meta->'channel_id',
        'scopes', to_jsonb('assistant:write chat:write.public chat:write commands files:read im:history incoming-webhook team:read users:read users:read.email'::text)
      )),
      NULL, v_status,
      CASE WHEN v_status = 'Expired' THEN 'No token was found for this workspace during the migration; reconnect it.' END,
      v_actor, v_actor
    )
    RETURNING id INTO v_id;

    IF v_status = 'Active' THEN
      PERFORM upsert_connection_secret(
        p_company_id, v_id, jsonb_build_object('accessToken', v_token)
      );
    END IF;
  END IF;

  -- Strip: the row is the installed flag from here on.
  IF v_row."secretRef" IS NOT NULL THEN
    PERFORM delete_integration_secret(p_company_id, 'slack');
  END IF;
  UPDATE "companyIntegration" SET metadata = '{}'::json, "secretRef" = NULL
    WHERE "companyId" = p_company_id AND id = 'slack';
END;
$$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT "companyId" FROM "companyIntegration" WHERE id = 'slack' LOOP
    PERFORM _backfill_slack_connection(r."companyId");
  END LOOP;
END;
$$;

DROP FUNCTION _backfill_slack_connection(text);

-- The jsonschema validated the now-gone workspace fields; like google-calendar,
-- the row holds nothing to validate.
UPDATE "integration" SET "jsonschema" = '{"type":"object","properties":{}}'::json
  WHERE id = 'slack';
