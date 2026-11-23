-- Enum additions live alone: ADD VALUE cannot be used in the same transaction as the value.
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Revenue Recognition';

DO $rvenums$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'revenueScheduleType') THEN
    CREATE TYPE "revenueScheduleType" AS ENUM ('Deferral', 'Accrual', 'Interest');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'revenueScheduleStatus') THEN
    CREATE TYPE "revenueScheduleStatus" AS ENUM ('Planned', 'Posted');
  END IF;
END $rvenums$;
