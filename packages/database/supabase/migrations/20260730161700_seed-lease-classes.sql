-- Seed default lease classes for existing companies (fixed-asset class seed
-- pattern, 20260525084319). Three classes per company, all mapping to the lease
-- GL accounts created in 20260730161600_lease-subledger.sql; lessee interest
-- expense reuses existing account 7010. Lessor accounts populated too so a
-- class is immediately usable in either role. Idempotent via (name, companyId).

INSERT INTO "leaseClass" (
  "name",
  "rouAssetAccountId",
  "accumulatedRouAmortizationAccountId",
  "leaseLiabilityAccountId",
  "interestExpenseAccountId",
  "rouAmortizationExpenseAccountId",
  "operatingLeaseExpenseAccountId",
  "variableLeaseExpenseAccountId",
  "leaseClearingAccountId",
  "leaseIncomeAccountId",
  "netInvestmentAccountId",
  "interestIncomeAccountId",
  "straightLineRentAccountId",
  "companyId",
  "createdBy"
)
SELECT
  cls.name,
  a1370."id",
  a1380."id",
  a2440."id",
  a7010."id",
  a6330."id",
  a6120."id",
  a6130."id",
  a2180."id",
  a4150."id",
  a1450."id",
  a4160."id",
  a2190."id",
  c."id",
  'system'
FROM "company" c
CROSS JOIN (
  VALUES ('Real Estate'), ('Equipment'), ('Vehicles')
) AS cls(name)
JOIN "account" a1370 ON a1370."companyGroupId" = c."companyGroupId" AND a1370."number" = '1370'
JOIN "account" a1380 ON a1380."companyGroupId" = c."companyGroupId" AND a1380."number" = '1380'
JOIN "account" a2440 ON a2440."companyGroupId" = c."companyGroupId" AND a2440."number" = '2440'
JOIN "account" a7010 ON a7010."companyGroupId" = c."companyGroupId" AND a7010."number" = '7010'
JOIN "account" a6330 ON a6330."companyGroupId" = c."companyGroupId" AND a6330."number" = '6330'
JOIN "account" a6120 ON a6120."companyGroupId" = c."companyGroupId" AND a6120."number" = '6120'
JOIN "account" a6130 ON a6130."companyGroupId" = c."companyGroupId" AND a6130."number" = '6130'
JOIN "account" a2180 ON a2180."companyGroupId" = c."companyGroupId" AND a2180."number" = '2180'
JOIN "account" a4150 ON a4150."companyGroupId" = c."companyGroupId" AND a4150."number" = '4150'
JOIN "account" a1450 ON a1450."companyGroupId" = c."companyGroupId" AND a1450."number" = '1450'
JOIN "account" a4160 ON a4160."companyGroupId" = c."companyGroupId" AND a4160."number" = '4160'
JOIN "account" a2190 ON a2190."companyGroupId" = c."companyGroupId" AND a2190."number" = '2190'
WHERE c."isEliminationEntity" IS NOT TRUE
ON CONFLICT ("name", "companyId") DO NOTHING;
