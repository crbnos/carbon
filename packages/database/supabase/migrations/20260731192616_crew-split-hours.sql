-- Split days: the hours an assignment occupies at its station. NULL = the
-- whole shift (the common case); a number = a partial-day slice, letting one
-- person's shift be dealt out across several stations sequentially.
ALTER TABLE "crewAssignment"
  ADD COLUMN "hours" NUMERIC(5,2)
  CHECK ("hours" IS NULL OR "hours" > 0);
