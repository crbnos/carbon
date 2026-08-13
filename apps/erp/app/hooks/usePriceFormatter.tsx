import { useCurrencyFormatter } from "./useCurrencyFormatter";

/**
 * Per-unit prices. Deliberately the SAME formatter as money — a price is an
 * amount in the same currency, so it renders at that currency's decimals, padded
 * to them. This is an alias, not a second implementation, so the two can never
 * drift apart again.
 *
 * Kept as its own name because ~60 call sites read better saying "price". The
 * one place the two genuinely differ is the editable price INPUT, which must
 * hold what storage holds — see `INPUT_FORMAT.price`.
 */
export const usePriceFormatter = useCurrencyFormatter;
