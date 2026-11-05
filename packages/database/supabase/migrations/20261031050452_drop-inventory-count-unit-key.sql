-- 20261030161119 created "inventoryCountLine_unit_key" on most databases, but
-- counts made before it can hold 2 lines of one unit in one bin (the snapshot
-- grouped by item as well), so it failed on others. Every writer of count lines
-- locks the count first, so the index guarded nothing the lock does not.
DROP INDEX IF EXISTS "inventoryCountLine_unit_key";
