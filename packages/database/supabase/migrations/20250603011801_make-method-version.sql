CREATE TYPE "makeMethodStatus" AS ENUM ('Draft', 'Active', 'Archived');

ALTER TABLE "makeMethod" DROP CONSTRAINT "makeMethod_unique_itemId";
ALTER TABLE "makeMethod" ADD COLUMN "version" NUMERIC(10, 2) NOT NULL DEFAULT 1;
ALTER TABLE "makeMethod" ADD COLUMN "status" "makeMethodStatus" NOT NULL DEFAULT 'Draft';
ALTER TABLE "makeMethod" ADD CONSTRAINT "makeMethod_unique_itemId_version" UNIQUE ("itemId", "version");
