-- Opt-in company setting to allow lowercase characters in item IDs (parts,
-- materials, consumables, tools, services). Default OFF preserves the behavior,
-- which forces the ID input to uppercase as the user types. When ON, the create
-- forms and properties sidebars leave the entered casing alone.
-- Named positively (allow...) per the companySettings boolean-flag convention.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "allowLowercaseItemIds" BOOLEAN NOT NULL DEFAULT FALSE;
