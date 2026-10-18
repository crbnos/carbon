-- A tax component's accounts must belong to its company's group.
--
-- The taxReceivedAccountId / taxPaidAccountId FKs (20261017032853) only check
-- that the account exists. `account` is scoped by companyGroupId, so a write
-- through PostgREST could name another group's account. Posting reads the
-- accounts by the company group, misses that one, and the GL and the tax
-- ledger then disagree. Same shape as check_charge_account_company_group
-- (20260922195151).

CREATE OR REPLACE FUNCTION public.check_tax_code_component_account_company_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  company_group_id text;
BEGIN
  IF NEW."taxReceivedAccountId" IS NULL AND NEW."taxPaidAccountId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c."companyGroupId" INTO company_group_id
  FROM "company" c
  WHERE c.id = NEW."companyId";

  IF company_group_id IS NULL
     OR (
       NEW."taxReceivedAccountId" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM "account" a
         WHERE a.id = NEW."taxReceivedAccountId"
           AND a."companyGroupId" = company_group_id
       )
     )
     OR (
       NEW."taxPaidAccountId" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM "account" a
         WHERE a.id = NEW."taxPaidAccountId"
           AND a."companyGroupId" = company_group_id
       )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'taxCodeComponent_account_companyGroup_check',
      MESSAGE = format(
        'Tax code component %s/%s references an account outside its company group',
        NEW.id,
        NEW."companyId"
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "taxCodeComponent_account_companyGroup_guard" ON "taxCodeComponent";
CREATE TRIGGER "taxCodeComponent_account_companyGroup_guard"
  BEFORE INSERT OR UPDATE OF "companyId", "taxReceivedAccountId", "taxPaidAccountId"
  ON "taxCodeComponent"
  FOR EACH ROW
  EXECUTE FUNCTION public.check_tax_code_component_account_company_group();
