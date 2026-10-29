-- Scope the public."user" table to the caller's own companies.
--
-- "Claims admin can view/modify users" was FOR ALL USING
-- has_any_company_permission('users_update') — true for anyone holding
-- users_update in ANY company, which every self-serve signup does in the
-- company it creates. It never looked at the row, so any signed-in user could
-- read, insert, update and delete every user in every tenant through PostgREST.
--
-- After this migration:
--   SELECT — self, anyone sharing a company (unchanged), plus employees of a
--            company where the user has an employee / customer / supplier
--            account (pending invites and deactivated people, which have no
--            userToCompany row but are listed on the People / account pages).
--   UPDATE — self, or an employee holding users_update in a company the user
--            is an active member of (userToCompany).
--   INSERT / DELETE — service role only. No app path writes these with a user
--            JWT; the grants are revoked so a future permissive policy cannot
--            reopen them.
-- Identity columns (id, email, active, admin, developer, isConsoleOperator)
-- are shared by every company the user belongs to and are kept in
-- step with auth.users, so an API-role UPDATE may not change them at all.

DROP POLICY IF EXISTS "Claims admin can view/modify users" ON "public"."user";

DROP POLICY IF EXISTS "Employees can view users with an account in their company" ON "public"."user";
CREATE POLICY "Employees can view users with an account in their company" ON "public"."user"
FOR SELECT USING (
  "id" IN (
    SELECT "id" FROM "employee"
    WHERE "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  )
  OR "id" IN (
    SELECT "id" FROM "customerAccount"
    WHERE "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  )
  OR "id" IN (
    SELECT "id" FROM "supplierAccount"
    WHERE "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
  )
);

-- The old self policy had WITH CHECK only; state both sides explicitly.
DROP POLICY IF EXISTS "Users can modify themselves" ON "public"."user";
CREATE POLICY "Users can modify themselves" ON "public"."user"
FOR UPDATE
USING ((SELECT auth.uid())::text = "id")
WITH CHECK ((SELECT auth.uid())::text = "id");

DROP POLICY IF EXISTS "Employees with users_update can update users in their company" ON "public"."user";
CREATE POLICY "Employees with users_update can update users in their company" ON "public"."user"
FOR UPDATE
USING (
  "id" IN (
    SELECT "userId" FROM "userToCompany"
    WHERE "companyId" = ANY ((SELECT get_companies_with_employee_permission('users_update'))::text[])
  )
)
WITH CHECK (
  "id" IN (
    SELECT "userId" FROM "userToCompany"
    WHERE "companyId" = ANY ((SELECT get_companies_with_employee_permission('users_update'))::text[])
  )
);

REVOKE INSERT, DELETE, TRUNCATE ON "public"."user" FROM anon, authenticated;

-- RLS cannot restrict columns, and a column-level GRANT would reject the
-- unchanged "id" that updatePublicAccount sends in its payload. So compare
-- instead: an API role may send these columns, but not change them.
CREATE OR REPLACE FUNCTION public.guard_user_identity_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND (
    NEW."id" IS DISTINCT FROM OLD."id" OR
    NEW."email" IS DISTINCT FROM OLD."email" OR
    NEW."active" IS DISTINCT FROM OLD."active" OR
    NEW."admin" IS DISTINCT FROM OLD."admin" OR
    NEW."developer" IS DISTINCT FROM OLD."developer" OR
    NEW."isConsoleOperator" IS DISTINCT FROM OLD."isConsoleOperator"
  ) THEN
    RAISE EXCEPTION 'These user fields can only be changed by the server'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "guard_user_identity_columns" ON "public"."user";
CREATE TRIGGER "guard_user_identity_columns"
BEFORE UPDATE ON "public"."user"
FOR EACH ROW
EXECUTE FUNCTION public.guard_user_identity_columns();

-- Deleting a user left its identity group behind (the group's id IS the user's
-- id, with no FK), so re-creating the same user id failed on group_pkey.
CREATE OR REPLACE FUNCTION sync_delete_user_identity_group(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_operation != 'DELETE' THEN RETURN; END IF;

  DELETE FROM "group"
  WHERE "id" = p_old->>'id'
    AND "isIdentityGroup" = TRUE;
END;
$$;

DROP TRIGGER IF EXISTS "trg_event_after_sync_user" ON "user";
CREATE TRIGGER "trg_event_after_sync_user"
AFTER INSERT OR UPDATE OR DELETE ON "user"
FOR EACH ROW
EXECUTE FUNCTION public.dispatch_event_after_interceptors(
  'sync_create_user_identity_group',
  'sync_update_user_identity_group',
  'sync_delete_user_identity_group'
);

-- Clear identity groups already orphaned by earlier deletes.
DELETE FROM "group" g
WHERE g."isIdentityGroup" = TRUE
  AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u."id" = g."id");
