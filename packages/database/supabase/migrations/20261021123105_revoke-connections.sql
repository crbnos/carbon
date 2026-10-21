-- Revoke workflow integration connections in ONE statement: drop each one's vault
-- secret and mark its row Revoked together. Before this, a disconnect was a vault
-- RPC and then a separate row UPDATE, so a failure between them left an Active row
-- with no secret: an account every surface lists as usable and every use fails.
--
-- With `p_connection_id`, that one connection of the piece (Disconnect). Without
-- it, every connection of the piece that is not already Revoked (Uninstall). The
-- row survives either way: a saved workflow node references its id. The secret is
-- deleted by its NAME, the way `upsert_connection_secret` stores it and
-- `get_connection_secret` reads it (20261021123103), never by `secretRef`.
CREATE OR REPLACE FUNCTION revoke_connections(
  p_company_id text,
  p_piece_name text,
  p_updated_by text,
  p_connection_id text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
BEGIN
  IF current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'revoke_connections is service role only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH revoked AS (
    UPDATE "integrationConnection"
    SET "status" = 'Revoked',
        "secretRef" = NULL,
        "updatedBy" = p_updated_by,
        "updatedAt" = NOW()
    WHERE "companyId" = p_company_id
      AND "pieceName" = p_piece_name
      AND CASE
        WHEN p_connection_id IS NULL THEN "status" <> 'Revoked'
        ELSE "id" = p_connection_id
      END
    RETURNING "id"
  )
  DELETE FROM vault.secrets s
    USING revoked r
    WHERE s.name = 'connection:' || p_company_id || ':' || r."id";
END;
$$;

-- Service-role only, enforced by the body's first statement: REVOKE EXECUTE on a
-- public function segfaults this Postgres image when anon/authenticated call it
-- (see 20260924192316_api-function-guards-not-revokes.sql).

NOTIFY pgrst, 'reload schema';
