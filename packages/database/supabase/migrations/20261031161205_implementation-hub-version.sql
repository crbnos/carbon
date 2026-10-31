-- Which Implementation Hub a company uses. 1.0 is the hub's pages and sidebar
-- (/x/get-started); 2.0 is one page per person (/x/implementation). Both read
-- the same hub records. Every company enrolled today stays on 1.0.
CREATE TYPE "implementationHubVersion" AS ENUM ('1.0', '2.0');

ALTER TABLE "implementationHub"
  ADD COLUMN "hubVersion" "implementationHubVersion" NOT NULL DEFAULT '1.0';
