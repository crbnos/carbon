-- Staff review pages only pending POs, newest first.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE INDEX IF NOT EXISTS "customerPortalSubmission_pendingPoPage_idx"
  ON "customerPortalSubmission" ("companyId", "createdAt" DESC, "id" DESC)
  WHERE "submissionType" = 'PO' AND "status" = 'Pending';

RESET statement_timeout;
RESET lock_timeout;
