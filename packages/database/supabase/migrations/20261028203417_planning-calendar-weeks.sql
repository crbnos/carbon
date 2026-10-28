-- The planning grids (Material Planning, Production Planning) and Demand
-- Forecasts head their weekly columns "Present Week, Week 2, Week 3, …" —
-- counted from today. A company that plans by calendar week (ISO 8601) turns
-- this on to head them with the week of the year instead: "Week 44, Week 45".
-- Display only: the periods, and what MRP writes into them, are unchanged.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "useCalendarWeeks" BOOLEAN NOT NULL DEFAULT false;
