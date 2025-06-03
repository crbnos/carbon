CREATE TYPE "makeMethodStatus" AS ENUM ('Draft', 'Active', 'Archived');

ALTER TABLE "makeMethod" DROP CONSTRAINT "makeMethod_unique_itemId";
ALTER TABLE "makeMethod" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "makeMethod" ADD COLUMN "status" "makeMethodStatus" NOT NULL DEFAULT 'Draft';
ALTER TABLE "makeMethod" ADD CONSTRAINT "makeMethod_unique_itemId_version" UNIQUE ("itemId", "version");
