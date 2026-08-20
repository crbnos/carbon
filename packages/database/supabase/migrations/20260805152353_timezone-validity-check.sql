-- The stored timezone is consumed by BOTH runtimes: Postgres (company_today()
-- via AT TIME ZONE) and ICU/Intl (the app's datetime API). The app layer
-- validates the ICU side; this constraint makes Postgres itself the arbiter of
-- the database side — a zone name the server cannot resolve is rejected at
-- write time instead of erroring inside a posting function later.
CREATE OR REPLACE FUNCTION is_valid_timezone(tz TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF tz IS NULL OR tz = '' THEN
    RETURN FALSE;
  END IF;
  PERFORM now() AT TIME ZONE tz;
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

-- NOT VALID: enforce on new writes without failing the migration if legacy
-- rows (e.g. free-text location timezones from before the picker) are invalid.
ALTER TABLE "company"
  ADD CONSTRAINT "company_timezone_valid"
  CHECK (is_valid_timezone("timezone")) NOT VALID;

ALTER TABLE "location"
  ADD CONSTRAINT "location_timezone_valid"
  CHECK (is_valid_timezone("timezone")) NOT VALID;

-- Timezone options for the app's pickers, sourced from the server's own tzdata
-- (pg_timezone_names) so the offered list is exactly what AT TIME ZONE
-- resolves — not a JS engine's Intl list, whose canonicalization and freshness
-- vary by engine. Filtered to canonical geographic zones + UTC; excludes
-- posix/*, right/*, Etc/* (inverted signs), bare abbreviations, and legacy
-- aliases (US/*, Brazil/*, ...). utc_offset is the zone's CURRENT offset.
CREATE OR REPLACE FUNCTION get_timezone_names()
RETURNS TABLE("name" TEXT, "utcOffset" TEXT)
LANGUAGE sql
STABLE
AS $$
  SELECT
    "name"::TEXT,
    "utc_offset"::TEXT
  FROM pg_timezone_names
  WHERE "name" ~ '^(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)/'
     OR "name" = 'UTC'
  ORDER BY "name";
$$;
