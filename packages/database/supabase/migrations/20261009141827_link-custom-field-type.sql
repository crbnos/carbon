-- Link: a custom field whose value is a web address, shown as a clickable link.
ALTER TABLE "attributeDataType" ADD COLUMN "isLink" BOOLEAN NOT NULL DEFAULT false;

-- Exactly one flag per data type, now including isLink.
ALTER TABLE "attributeDataType" DROP CONSTRAINT "userAttributeDataType_singleDataType";

ALTER TABLE "attributeDataType" ADD CONSTRAINT "userAttributeDataType_singleDataType"
  CHECK (
    "isBoolean"::int +
    "isDate"::int +
    "isList"::int +
    "isNumeric"::int +
    "isText"::int +
    "isUser"::int +
    "isCustomer"::int +
    "isSupplier"::int +
    "isFile"::int +
    "isLink"::int = 1
  );

-- The app's DataType enum names ids, so the row takes its id explicitly rather
-- than whatever the sequence hands out next.
INSERT INTO "attributeDataType" ("id", "label", "isLink")
VALUES (10, 'Link', true);

SELECT setval(
  pg_get_serial_sequence('"attributeDataType"', 'id'),
  (SELECT MAX("id") FROM "attributeDataType")
);
