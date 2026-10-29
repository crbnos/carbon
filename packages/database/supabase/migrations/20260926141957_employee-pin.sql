-- Console PINs out of the API's reach, and console mode out of the REST API's
-- write path.
--
-- 1. `employee.pin` held every console PIN in PLAINTEXT, and `employee` is
--    readable by every member of the company and every API key through
--    PostgREST — anyone could read a colleague's PIN and pin in as them at a
--    shared MES terminal. The PIN moves to "employeePin" as a bcrypt hash, on a
--    table with RLS enabled and NO policies (and no API-role privileges), so no
--    anon/authenticated/API-key request can read or write it. Only the servers'
--    direct Kysely connection (and service_role) reach it, through
--    set_employee_pin / verify_employee_pin.
--
-- 2. `companySettings.consoleEnabled` gates a commercial feature, but the
--    table's UPDATE policy lets any `settings_update` holder PATCH it over REST
--    and skip the entitlement lock in `@carbon/ee` updateConsoleSetting. A
--    trigger refuses the change when it arrives through the API roles.

-- ── 1. employeePin ─────────────────────────────────────────────────────────

CREATE TABLE "employeePin" (
  "employeeId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "pinHash" TEXT NOT NULL,
  "updatedBy" TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "employeePin_pkey" PRIMARY KEY ("employeeId", "companyId"),
  CONSTRAINT "employeePin_employee_fkey" FOREIGN KEY ("employeeId", "companyId")
    REFERENCES "employee"("id", "companyId") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "employeePin_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX "employeePin_companyId_idx" ON "employeePin" ("companyId");
CREATE INDEX "employeePin_updatedBy_idx" ON "employeePin" ("updatedBy");

-- RLS on with NO policies: an API role sees zero rows and every write fails.
-- The table privileges go too, so the refusal is a plain "permission denied"
-- (a table privilege revoke is an ordinary error on this image — it is only
-- REVOKE EXECUTE on a function that crashes the backend, see .ai/lessons.md).
ALTER TABLE "employeePin" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."employeePin" FROM anon, authenticated;

-- Both functions are SECURITY INVOKER on purpose: through /rest/v1/rpc they run
-- as the API role and can touch nothing, while the servers' direct connection
-- (table owner) runs them normally. No SECURITY DEFINER, so there is no caller
-- to authorize (public-definer-function-authorizes-caller).
CREATE OR REPLACE FUNCTION public.set_employee_pin(
  p_employee_id TEXT,
  p_company_id TEXT,
  p_pin TEXT,
  p_updated_by TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'PIN must be 4 digits' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO "employeePin" ("employeeId", "companyId", "pinHash", "updatedBy", "updatedAt")
  VALUES (
    p_employee_id,
    p_company_id,
    extensions.crypt(p_pin, extensions.gen_salt('bf')),
    p_updated_by,
    NOW()
  )
  ON CONFLICT ("employeeId", "companyId") DO UPDATE SET
    "pinHash" = EXCLUDED."pinHash",
    "updatedBy" = EXCLUDED."updatedBy",
    "updatedAt" = EXCLUDED."updatedAt";
END;
$$;

-- False for a wrong PIN, a NULL PIN, and an employee with no PIN alike.
CREATE OR REPLACE FUNCTION public.verify_employee_pin(
  p_employee_id TEXT,
  p_company_id TEXT,
  p_pin TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT COALESCE((
    SELECT ep."pinHash" = extensions.crypt(p_pin, ep."pinHash")
    FROM "employeePin" ep
    WHERE ep."employeeId" = p_employee_id
      AND ep."companyId" = p_company_id
  ), false);
$$;

-- Carry every existing PIN over, hashed, then drop the plaintext column.
-- (gen_salt is volatile, so each row gets its own salt.)
INSERT INTO "employeePin" ("employeeId", "companyId", "pinHash", "updatedAt")
SELECT
  "id",
  "companyId",
  extensions.crypt("pin", extensions.gen_salt('bf')),
  NOW()
FROM "employee"
WHERE "pin" IS NOT NULL AND "pin" <> '';

ALTER TABLE "employee" DROP COLUMN "pin";

-- ── 2. companySettings.consoleEnabled is server-only ──────────────────────

-- Modelled on guard_user_identity_columns. Reads the request ROLE rather than
-- current_user, so the refusal also holds inside a SECURITY DEFINER function a
-- PostgREST request reaches. The servers' direct connection has role 'none' and
-- service_role is neither API role, so updateConsoleSetting (which writes over
-- Kysely after its requireEntitlement lock) is unaffected. Other columns of
-- companySettings stay writable over REST exactly as before.
CREATE OR REPLACE FUNCTION public.guard_company_settings_console_enabled()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW."consoleEnabled" IS DISTINCT FROM OLD."consoleEnabled"
    AND current_setting('role', true) IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Console mode can only be changed by the server'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "guard_company_settings_console_enabled" ON "public"."companySettings";
CREATE TRIGGER "guard_company_settings_console_enabled"
BEFORE UPDATE ON "public"."companySettings"
FOR EACH ROW
EXECUTE FUNCTION public.guard_company_settings_console_enabled();
