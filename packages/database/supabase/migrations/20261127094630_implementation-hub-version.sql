-- Which Implementation Hub a company uses. 1.0 is the hub's pages and sidebar
-- (/x/get-started); 2.0 is one page per person (/x/implementation). Both read
-- the same hub records. Every company enrolled today stays on 1.0.
DO $$ BEGIN
  CREATE TYPE "implementationHubVersion" AS ENUM ('1.0', '2.0');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "implementationHub"
  ADD COLUMN IF NOT EXISTS "hubVersion" "implementationHubVersion" NOT NULL DEFAULT '1.0';
