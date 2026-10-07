-- The change log must not hold a foreign key to "company". Deleting a company
-- cascades to its items and customers, whose log_table_changes trigger then
-- inserts a "tableChange" row for a company that is already gone in that
-- transaction: the insert fails the key and aborts the delete.
-- Rows of a deleted company are removed by the hourly retention purge.
ALTER TABLE "tableChange" DROP CONSTRAINT IF EXISTS "tableChange_companyId_fkey";
