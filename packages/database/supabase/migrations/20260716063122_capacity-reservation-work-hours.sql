-- A reservation's [startAt, endAt) is WALL-CLOCK span: for ability-gated
-- operations it includes off-shift pauses, so a 6h solder can span 22h. The
-- panel needs the actual work content to say "6h of work across 22h" instead
-- of a misleading 22h duration. The engine knows the work hours at placement
-- time; persist them alongside the interval.
ALTER TABLE "capacityReservation"
  ADD COLUMN "workHours" NUMERIC;

COMMENT ON COLUMN "capacityReservation"."workHours" IS
  'Actual work content (hours) inside this reservation; endAt - startAt minus off-shift pauses. Null on legacy rows and manual pins.';
