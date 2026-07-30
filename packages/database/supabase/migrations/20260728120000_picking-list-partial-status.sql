-- Add a 'Partial' header status for picking lists finished with material still
-- unpicked. Kept in its own migration: `ALTER TYPE ... ADD VALUE` cannot share a
-- transaction with statements that use the new value (the policy column + trigger
-- rewrite that reference 'Partial' land in the next migration).
ALTER TYPE "pickingListStatus" ADD VALUE IF NOT EXISTS 'Partial';
