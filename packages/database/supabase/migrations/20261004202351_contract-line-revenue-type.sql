-- A contract line's One-time / Recurring choice is its revenue type. "kind" says
-- nothing about what the field decides (.claude/rules/conventions-database.md).
ALTER TYPE "customerContractLineKind" RENAME TO "contractRevenueType";
ALTER TABLE "customerContractLine" RENAME COLUMN "kind" TO "revenueType";
