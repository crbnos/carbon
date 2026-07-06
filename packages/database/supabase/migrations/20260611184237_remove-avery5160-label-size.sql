-- The avery5160 label size has been removed from the app. Move column
-- defaults and any existing settings to avery5163 (the remaining sheet size).

ALTER TABLE "companySettings" ALTER COLUMN "productLabelSize" SET DEFAULT 'avery5163';
ALTER TABLE "companySettings" ALTER COLUMN "shelfLabelSize" SET DEFAULT 'avery5163';

UPDATE "companySettings" SET "productLabelSize" = 'avery5163' WHERE "productLabelSize" = 'avery5160';
UPDATE "companySettings" SET "shelfLabelSize" = 'avery5163' WHERE "shelfLabelSize" = 'avery5160';
