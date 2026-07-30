-- Change Order → Change Notice: new records get CN-, existing readableIds are
-- left alone (they are audit trail and referenced externally).
UPDATE "sequence"
SET "prefix" = 'CN-', "name" = 'Change Notice'
WHERE "table" = 'changeOrder' AND "prefix" = 'ECO-';
