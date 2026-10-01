-- Record how each quote line price was reached, per quantity break.
--
-- Pricing rules are edited in place, so re-running today's rules cannot
-- explain a price set under yesterday's. "priceTrace" is the PriceTraceStep[]
-- the pricing run produced (base → overrides → rules → final), written with
-- the price it explains. NULL means no rule produced the price: a manual
-- ('manual' priceSource) price, or a row priced before this column existed.
--
-- quoteLine."priceTrace" (20260413120001_pricing-rules.sql) is one trace per
-- line and cannot describe several quantity breaks; nothing fills it (quote
-- copies carry it over, always NULL).

ALTER TABLE "quoteLinePrice" ADD COLUMN IF NOT EXISTS "priceTrace" JSONB;
