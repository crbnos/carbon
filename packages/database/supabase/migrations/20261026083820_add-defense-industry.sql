-- The defense demo dataset needs an industry to attach to. `industry` is a
-- global curated catalog (TEXT primary key, no companyId, no audit columns), so
-- the company-scoped table template does not apply here.

INSERT INTO "industry" ("id", "name", "description", "iconName", "sortOrder")
VALUES (
  'defense_uas',
  'Defense & Unmanned Systems',
  'Military small unmanned aircraft systems and defense electronics manufacturing',
  'shield',
  5
)
ON CONFLICT ("id") DO NOTHING;
