ALTER TABLE "attributeDataType" 
ADD COLUMN "isCustomer" BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN "isSupplier" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "attributeDataType" DROP CONSTRAINT "userAttributeDataType_singleDataType";

ALTER TABLE "attributeDataType" ADD CONSTRAINT "userAttributeDataType_singleDataType"
  CHECK (
    (
      "isBoolean" = true AND 
      "isDate" = false AND 
      "isList" = false AND 
      "isNumeric" = false AND 
      "isText" = false AND 
      "isUser" = false AND
      "isCustomer" = false AND
      "isSupplier" = false
    ) 
    OR (
      "isBoolean" = false AND 
      "isDate" = true AND 
      "isList" = false AND 
      "isNumeric" = false AND 
      "isText" = false AND 
      "isUser" = false AND
      "isCustomer" = false AND
      "isSupplier" = false
    ) 
    OR (
      "isBoolean" = false AND 
      "isDate" = false AND 
      "isList" = true AND 
      "isNumeric" = false AND 
      "isText" = false AND 
      "isUser" = false AND
      "isCustomer" = false AND
      "isSupplier" = false
    ) 
    OR (
      "isBoolean" = false AND 
      "isDate" = false AND 
      "isList" = false AND 
      "isNumeric" = true AND 
      "isText" = false AND 
      "isUser" = false AND
      "isCustomer" = false AND
      "isSupplier" = false
    ) 
    OR (
      "isBoolean" = false AND 
      "isDate" = false AND 
      "isList" = false AND 
      "isNumeric" = false AND 
      "isText" = true AND 
      "isUser" = false AND
      "isCustomer" = false AND
      "isSupplier" = false
    ) 
    OR (
      "isBoolean" = false AND 
      "isDate" = false AND 
      "isList" = false AND 
      "isNumeric" = false AND 
      "isText" = false AND 
      "isUser" = true AND
      "isCustomer" = false AND
      "isSupplier" = false
    )
    OR (
      "isBoolean" = false AND 
      "isDate" = false AND 
      "isList" = false AND 
      "isNumeric" = false AND 
      "isText" = false AND 
      "isUser" = false AND
      "isCustomer" = true AND
      "isSupplier" = false
    )
    OR (
      "isBoolean" = false AND 
      "isDate" = false AND 
      "isList" = false AND 
      "isNumeric" = false AND 
      "isText" = false AND 
      "isUser" = false AND
      "isCustomer" = false AND
      "isSupplier" = true
    )
  );

INSERT INTO "attributeDataType" ("label", "isBoolean", "isDate", "isList", "isNumeric", "isText", "isUser", "isCustomer", "isSupplier")
VALUES 
  ('Customer', false, false, false, false, false, false, true, false),
  ('Supplier', false, false, false, false, false, false, false, true);
