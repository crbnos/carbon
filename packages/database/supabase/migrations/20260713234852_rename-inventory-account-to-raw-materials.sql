-- Rename each company's raw-materials account to "Raw Materials" for existing companies.
--
-- The raw-materials / finished-goods split (20260713190909) created a new
-- "Finished Goods" (1220) account per company group and repointed the
-- rawMaterialsAccount default at the OLD inventory account — but per that spec it
-- deliberately left existing account NAMES untouched. New companies are seeded
-- with 1210 named "Raw Materials", so existing companies diverged: they show a
-- "Finished Goods" account but their raw stock is still labelled "Inventory" and
-- there is no "Raw Materials" account at all. This aligns existing companies with
-- the seed by renaming the account each company's rawMaterialsAccount default
-- points at to "Raw Materials" — whatever it is currently named.
--
-- Safe + idempotent:
--   * Touches only the account referenced by accountDefault.rawMaterialsAccount,
--     regardless of its current name (a chart an admin renamed still gets aligned).
--   * Posting accounts only (isGroup = false).
--   * Skips any account that also serves as finishedGoodsAccount — the customized-
--     COA fallback where no 1220 could be created and one account does double duty
--     (Step 3 of the split); those are left for a manual reclass rather than being
--     mislabelled.
--   * Skips if a "Raw Materials" account already exists in the same company group,
--     so the UNIQUE ("name","companyGroupId","isGroup") constraint can never trip.
--     This also makes the statement a no-op on re-run: once renamed, the account is
--     itself the group's "Raw Materials" row, so the guard excludes it. (The WHERE
--     is evaluated against the pre-update snapshot, so the first run still fires.)

UPDATE "account"
SET "name" = 'Raw Materials',
    "updatedBy" = 'system',
    "updatedAt" = NOW()
WHERE "isGroup" = false
  AND "id" IN (
    SELECT "rawMaterialsAccount" FROM "accountDefault"
    WHERE "rawMaterialsAccount" IS NOT NULL
  )
  AND "id" NOT IN (
    SELECT "finishedGoodsAccount" FROM "accountDefault"
    WHERE "finishedGoodsAccount" IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM "account" rm
    WHERE rm."companyGroupId" = "account"."companyGroupId"
      AND rm."name" = 'Raw Materials'
      AND rm."isGroup" = false
  );
