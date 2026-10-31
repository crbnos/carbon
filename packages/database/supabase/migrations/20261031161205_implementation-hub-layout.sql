-- Which Implementation Hub layout a company uses. Company Plan is the hub's
-- pages and sidebar; Personal Pages is one page per person. Both read the same
-- hub records. Every company enrolled today keeps Company Plan.
CREATE TYPE "implementationLayout" AS ENUM ('Company Plan', 'Personal Pages');

ALTER TABLE "implementationHub"
  ADD COLUMN "layout" "implementationLayout" NOT NULL DEFAULT 'Company Plan';
