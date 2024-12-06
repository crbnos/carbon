-- Add the unitPricePrecision to quoteLine and quoteLinePrice
ALTER TABLE "quoteLine" ADD COLUMN "unitPricePrecision" INTEGER NOT NULL DEFAULT 2 CHECK ("unitPricePrecision" IN (2, 3, 4));
ALTER TABLE "quoteLinePrice" ADD COLUMN "unitPricePrecision" INTEGER NOT NULL DEFAULT 2 CHECK ("unitPricePrecision" IN (2, 3, 4));

-- Add a trigger to update the unitPricePrecision on quoteLinePrice when the unitPricePrecision on quoteLine is updated
CREATE OR REPLACE FUNCTION update_quote_line_price_unit_price_precision()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE "quoteLinePrice"
  SET "unitPricePrecision" = NEW."unitPricePrecision"
  WHERE "quoteLineId" = NEW."id";
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER update_quote_line_price_unit_price_precision_trigger
AFTER UPDATE OF "unitPricePrecision" ON "quoteLine"
FOR EACH ROW
WHEN (OLD."unitPricePrecision" IS DISTINCT FROM NEW."unitPricePrecision")
EXECUTE FUNCTION update_quote_line_price_unit_price_precision();