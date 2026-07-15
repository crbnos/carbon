-- Per-placement explanation for the schedule timeline. The engine knows why
-- every operation starts when it does (queued behind other jobs, waiting on a
-- predecessor, waiting for an operator) but previously only surfaced it for
-- LATE placements via jobOperation.conflictReason. These columns keep it for
-- every placed operation so the Gantt can draw the wait (ghost segment from
-- earliestStartAt to startAt) and say the reason in plain words.
ALTER TABLE "capacityReservation"
  ADD COLUMN "earliestStartAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN "scheduleNote" TEXT;

COMMENT ON COLUMN "capacityReservation"."earliestStartAt" IS
  'When the operation could have started at the earliest; startAt - earliestStartAt is time spent waiting. Null when unknown (legacy rows).';
COMMENT ON COLUMN "capacityReservation"."scheduleNote" IS
  'Human-readable reason for the placement timing (English, engine-generated), e.g. "Waited 14h for the work center - queued behind J000010 (2 ops)". Null when the operation started as early as it could.';
