-- "Include work instructions" is now a Job Traveler template option (operations
-- block "Show work instructions"). The company flag used to be authoritative at
-- render, so bake each company's actual flag value into its jobTraveler
-- template's operations block before dropping the column — true OR false — so
-- travelers render identically. (Companies with no stored template fall back to
-- the template default of OFF, matching the old column default of false.)
UPDATE "documentTemplate" dt
SET blocks = (
  SELECT jsonb_agg(
    CASE
      WHEN block->>'type' = 'operations' THEN block
        || jsonb_build_object(
             'showWorkInstructions', cs."jobTravelerIncludeWorkInstructions"
           )
      ELSE block
    END
  )
  FROM jsonb_array_elements(dt.blocks) AS block
)
FROM "companySettings" cs
WHERE cs.id = dt."companyId"
  AND dt."documentType" = 'jobTraveler'
  AND dt.blocks @> '[{"type":"operations"}]';

ALTER TABLE "companySettings"
  DROP COLUMN IF EXISTS "jobTravelerIncludeWorkInstructions";
