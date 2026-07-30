-- Split the single "Gains & Losses on Disposal" GL account into a distinct
-- Gain on Disposal account and a Loss on Disposal account.
--
-- The current combined account becomes the LOSS account (renamed in place); a new
-- Gain on Disposal account is created per company group and back-filled into the
-- new gain columns on accountDefault and fixedAssetClass.
--
-- Idempotent throughout: the deploy runner may retry this file over a partially
-- applied state, so every read of the dropped column is gated on its existence
-- and every back-fill COALESCEs to a NOT-NULL fallback.

-- ── accountDefault: add the two new columns up front (so the gated back-fill can set them) ──
ALTER TABLE "accountDefault"
  ADD COLUMN IF NOT EXISTS "assetGainOnDisposalAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "assetLossOnDisposalAccount" TEXT;

-- ── Everything that reads the old assetGainsAndLossesAccount column runs here,
--    gated on the column still existing (skipped on a post-drop retry) ──────────
DO $$
DECLARE
  grp      text;
  v_parent text;
  v_number text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'accountDefault' AND column_name = 'assetGainsAndLossesAccount'
  ) THEN
    RETURN; -- already migrated
  END IF;

  -- Step A: one "Gain on Disposal" account per company group (idempotent by name).
  -- Always Revenue / Other Income so a gain is credited to a revenue account (the
  -- disposal posting books gains with credit("revenue", ...); its sign depends on
  -- the account class). Placed under the group's "Other Income" group when present,
  -- else top-level (never nested under an expense group).
  FOR grp IN SELECT id FROM "companyGroup" LOOP
    IF EXISTS (
      SELECT 1 FROM "account"
      WHERE "companyGroupId" = grp AND name = 'Gain on Disposal'
    ) THEN
      CONTINUE;
    END IF;

    SELECT id INTO v_parent
    FROM "account"
    WHERE "companyGroupId" = grp
      AND "isGroup"
      AND ("accountType" = 'Other Income' OR name ILIKE 'other income')
    ORDER BY (name ILIKE 'other income') DESC
    LIMIT 1;

    -- Number 4140 when free in the group, else leave unnumbered.
    v_number := '4140';
    IF EXISTS (SELECT 1 FROM "account" WHERE "companyGroupId" = grp AND number = v_number) THEN
      v_number := NULL;
    END IF;

    INSERT INTO "account" (
      id, number, name, class, "accountType", "incomeBalance", "consolidatedRate",
      "parentId", "isGroup", active, "isSystem", "companyGroupId", "createdBy"
    )
    VALUES (
      id('acct'), v_number, 'Gain on Disposal', 'Revenue', 'Other Income',
      'Income Statement', 'Average', v_parent, false, true, false, grp, 'system'
    );
  END LOOP;

  -- Rename the existing combined account to reflect its new role (default name only).
  UPDATE "account" SET name = 'Loss on Disposal' WHERE name = 'Gains and Losses on Disposal';

  -- Step B: back-fill the new accountDefault columns.
  UPDATE "accountDefault" ad
  SET
    "assetLossOnDisposalAccount" = COALESCE(ad."assetLossOnDisposalAccount", ad."assetGainsAndLossesAccount"),
    "assetGainOnDisposalAccount" = COALESCE(
      ad."assetGainOnDisposalAccount",
      (
        SELECT g.id FROM "account" g
        JOIN "company" c ON c.id = ad."companyId"
        WHERE g."companyGroupId" = c."companyGroupId" AND g.name = 'Gain on Disposal'
        LIMIT 1
      ),
      ad."assetGainsAndLossesAccount" -- NOT-NULL fallback
    );
END $$;

-- ── accountDefault: enforce, wire FKs, drop the old column ─────────────────────
ALTER TABLE "accountDefault"
  ALTER COLUMN "assetGainOnDisposalAccount" SET NOT NULL,
  ALTER COLUMN "assetLossOnDisposalAccount" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accountDefault_assetGainOnDisposalAccount_fkey') THEN
    ALTER TABLE "accountDefault"
      ADD CONSTRAINT "accountDefault_assetGainOnDisposalAccount_fkey"
      FOREIGN KEY ("assetGainOnDisposalAccount") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accountDefault_assetLossOnDisposalAccount_fkey') THEN
    ALTER TABLE "accountDefault"
      ADD CONSTRAINT "accountDefault_assetLossOnDisposalAccount_fkey"
      FOREIGN KEY ("assetLossOnDisposalAccount") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "accountDefault" DROP CONSTRAINT IF EXISTS "accountDefault_assetGainsAndLossesAccount_fkey";
ALTER TABLE "accountDefault" DROP COLUMN IF EXISTS "assetGainsAndLossesAccount";

-- ── fixedAssetClass: disposalAccountId becomes the loss account; add the gain column ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fixedAssetClass' AND column_name = 'disposalAccountId'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fixedAssetClass' AND column_name = 'lossOnDisposalAccountId'
  ) THEN
    ALTER TABLE "fixedAssetClass" RENAME COLUMN "disposalAccountId" TO "lossOnDisposalAccountId";
    ALTER TABLE "fixedAssetClass" RENAME CONSTRAINT "fixedAssetClass_disposalAccountId_fkey" TO "fixedAssetClass_lossOnDisposalAccountId_fkey";
  END IF;
END $$;

ALTER TABLE "fixedAssetClass" ADD COLUMN IF NOT EXISTS "gainOnDisposalAccountId" TEXT;

UPDATE "fixedAssetClass" fac
SET "gainOnDisposalAccountId" = COALESCE(
  fac."gainOnDisposalAccountId",
  (
    SELECT g.id FROM "account" g
    JOIN "company" c ON c.id = fac."companyId"
    WHERE g."companyGroupId" = c."companyGroupId" AND g.name = 'Gain on Disposal'
    LIMIT 1
  ),
  fac."lossOnDisposalAccountId" -- NOT-NULL fallback
);

ALTER TABLE "fixedAssetClass" ALTER COLUMN "gainOnDisposalAccountId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixedAssetClass_gainOnDisposalAccountId_fkey') THEN
    ALTER TABLE "fixedAssetClass"
      ADD CONSTRAINT "fixedAssetClass_gainOnDisposalAccountId_fkey"
      FOREIGN KEY ("gainOnDisposalAccountId") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
