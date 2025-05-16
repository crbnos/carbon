
ALTER TABLE "makeMethod" DROP CONSTRAINT "makeMethod_unique_itemId";
ALTER TABLE "makeMethod" ADD CONSTRAINT "makeMethod_unique_itemId_revision" UNIQUE ("itemId", "revision");
ALTER TABLE "makeMethod" ADD COLUMN "revision" TEXT NOT NULL DEFAULT '0';
