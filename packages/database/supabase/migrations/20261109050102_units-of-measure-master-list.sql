-- Every company holds Carbon's whole list of standard units of measure
-- (unitOfMeasureCatalog in packages/database/src/units-of-measure.ts; the
-- units-of-measure-master-list test keeps the two equal). New companies get the
-- list from seedCompany; this gives existing companies the units they lack.
--
-- A unit of the company's measurement system is added active. A unit of the
-- other system is added inactive: it stays out of the unit pickers until
-- someone turns it on under Items -> Units of Measure. A unit is skipped when
-- the company has one with its code or its name, ignoring case and spaces, so
-- a company keeps its Meter as MT and its Liter as LT. Units the company has
-- are not changed.
--
-- A company is metric when Settings -> Items -> Metric is on, or when it is
-- outside the US and its territories (by base currency when it has no
-- country), the rule new companies follow. Companies created from 2026-04-10
-- were left with Metric off, so the setting alone would make a company in
-- Norway imperial.

WITH "catalog" ("code", "name", "activeWhenMetric", "activeWhenImperial") AS (
  VALUES
    ('EA', 'Each', true, true),
    ('CS', 'Case', true, true),
    ('PK', 'Pack', true, true),
    ('PL', 'Pallet', true, true),
    ('RL', 'Roll', true, true),
    ('BX', 'Box', true, true),
    ('BG', 'Bag', true, true),
    ('DR', 'Drum', true, true),
    ('g', 'Gram', true, false),
    ('kg', 'Kilogram', true, false),
    ('t', 'Tonne', true, false),
    ('mm', 'Millimeter', true, false),
    ('cm', 'Centimeter', true, false),
    ('m', 'Meter', true, true),
    ('m2', 'Square Meter', true, false),
    ('m3', 'Cubic Meter', true, false),
    ('mL', 'Milliliter', true, false),
    ('L', 'Liter', true, true),
    ('OZ', 'Ounce', false, true),
    ('LB', 'Pound', false, true),
    ('TN', 'Ton', false, true),
    ('INCH', 'Inch', false, true),
    ('FOOT', 'Foot', false, true),
    ('YD', 'Yard', false, true),
    ('FT2', 'Square Foot', false, true),
    ('FT3', 'Cubic Foot', false, true),
    ('GL', 'Gallon', false, true)
),
"companyMeasurement" AS (
  SELECT
    c."id" AS "companyId",
    COALESCE(cs."useMetric", false) OR CASE
      WHEN NULLIF(c."countryCode", '') IS NOT NULL
        THEN upper(c."countryCode") NOT IN ('US', 'AS', 'GU', 'MP', 'PR', 'UM', 'VI')
      ELSE COALESCE(NULLIF(c."baseCurrencyCode", ''), 'USD') <> 'USD'
    END AS "useMetric"
  FROM "company" c
  LEFT JOIN "companySettings" cs ON cs."id" = c."id"
)
INSERT INTO "unitOfMeasure" ("code", "name", "active", "companyId", "createdBy")
SELECT
  cat."code",
  cat."name",
  CASE WHEN m."useMetric" THEN cat."activeWhenMetric" ELSE cat."activeWhenImperial" END,
  m."companyId",
  'system'
FROM "companyMeasurement" m
CROSS JOIN "catalog" cat
WHERE NOT EXISTS (
  SELECT 1
  FROM "unitOfMeasure" u
  WHERE u."companyId" = m."companyId"
    AND (
      lower(regexp_replace(u."code", '\s', '', 'g')) = lower(cat."code")
      OR lower(regexp_replace(u."name", '\s', '', 'g'))
        = lower(regexp_replace(cat."name", '\s', '', 'g'))
    )
)
ON CONFLICT DO NOTHING;
