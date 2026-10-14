-- The time of day scheduled MRP runs for a company, on the company's own clock
-- (company.timezone). NULL keeps the default cadence: every 3 hours. When set,
-- the scheduled run happens once a day at this time instead. Manual runs and
-- the runs triggered by order/job status changes are unaffected.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "mrpRunTime" TIME;
