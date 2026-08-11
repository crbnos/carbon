import { quantityFormatOptions } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";

/**
 * Formats a quantity for display at full storage precision (up to five
 * decimals). Presentation only — the underlying quantity is never rounded, so
 * BOMs, costing, reports, exports and the API keep the exact value. Whole
 * numbers stay whole: `3` renders as "3", and a genuinely small stored value
 * renders itself ("0.00125") rather than a placeholder.
 */
export function formatQuantityForDisplay(
  quantity: number,
  formatter: Intl.NumberFormat
) {
  if (!Number.isFinite(quantity)) return "";

  return formatter.format(quantity);
}

export function useQuantityFormatter() {
  const { locale } = useLocale();

  return useMemo(() => {
    const formatter = new Intl.NumberFormat(locale, quantityFormatOptions());

    return (quantity: number) => formatQuantityForDisplay(quantity, formatter);
  }, [locale]);
}
