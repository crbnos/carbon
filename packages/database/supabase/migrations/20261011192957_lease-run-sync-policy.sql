-- Rental deferral, accrual and sales-type interest journals now post in lease runs,
-- as source type 'Lease Run', not 'Revenue Recognition'. Give each accounting
-- integration's 'Lease Run' the setting its 'Revenue Recognition' had, so those
-- journals keep syncing exactly as before. A row that already has 'Lease Run' keeps it.
-- Spec: .ai/specs/2026-10-11-lessee-leases.md §6.
--
-- `companyIntegration.metadata` is `json`, NOT `jsonb`: cast for the edit and back.
UPDATE "companyIntegration"
SET metadata = jsonb_set(
  metadata::jsonb,
  '{settings,postingSync,sourceTypes,Lease Run}',
  (metadata::jsonb) #> '{settings,postingSync,sourceTypes,Revenue Recognition}'
)::json
WHERE jsonb_typeof((metadata::jsonb) #> '{settings,postingSync,sourceTypes}') = 'object'
  AND (metadata::jsonb) #> '{settings,postingSync,sourceTypes,Revenue Recognition}' IS NOT NULL
  AND (metadata::jsonb) #> '{settings,postingSync,sourceTypes,Lease Run}' IS NULL;
