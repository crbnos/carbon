-- journal.approvalRequestId links a posted JE back to the approvalRequest that
-- authorized it (added in 20260706193000_document-approvals.sql as a bare TEXT
-- column). Its siblings preparedBy/approvedBy are FK-constrained to "user", but
-- approvalRequestId had no referential integrity, so a dangling/typo'd id would
-- go undetected. Add the FK here (already-applied migrations must not be edited).
--
-- approvalRequest's primary key is composite ("id", "companyId"), so the FK must
-- be composite too — matching the repo's tenant-scoped FK pattern
-- (20260703143904_composite-tenant-fks.sql). ADD ... NOT VALID takes only a
-- brief lock (no table scan); the separate VALIDATE CONSTRAINT then verifies
-- existing rows under a lighter SHARE UPDATE EXCLUSIVE lock. approvalRequestId
-- is currently unpopulated, so validation is effectively free.

ALTER TABLE "journal"
  ADD CONSTRAINT "journal_approvalRequestId_fkey"
  FOREIGN KEY ("approvalRequestId", "companyId")
  REFERENCES "approvalRequest" ("id", "companyId")
  NOT VALID;

ALTER TABLE "journal" VALIDATE CONSTRAINT "journal_approvalRequestId_fkey";
