-- The satellite demo dataset needs an industry to attach to. `industry` is a
-- global curated catalog (TEXT primary key, no companyId, no audit columns), so
-- the company-scoped table template does not apply here.

INSERT INTO "industry" ("id", "name", "description", "iconName", "sortOrder")
VALUES (
  'aerospace_satellite',
  'Aerospace & Satellite',
  'Small-satellite and spacecraft subsystem manufacturing',
  'satellite',
  4
)
ON CONFLICT ("id") DO NOTHING;
