-- The country seed (20240928155702_country-codes.sql) lists sovereign states
-- only, so Hong Kong, Macao and Taiwan could not be selected. Each has its own
-- ISO 3166-1 code, and a bank's BIC carries that code (HSBCHKHH, not ...CN...),
-- so a Hong Kong bank account could not be saved under any country: China
-- fails the BIC country check, and Hong Kong was not in the list.

INSERT INTO "country" ("name", "alpha2", "alpha3") VALUES
('Hong Kong', 'HK', 'HKG'),
('Macao', 'MO', 'MAC'),
('Taiwan', 'TW', 'TWN')
ON CONFLICT DO NOTHING;
