ALTER TABLE "tableView" DROP CONSTRAINT IF EXISTS "tableView_name_table_createdBy_key";

ALTER TABLE "tableView" ADD CONSTRAINT "tableView_name_table_createdBy_companyId_key" UNIQUE ("name", "table", "createdBy", "companyId");
