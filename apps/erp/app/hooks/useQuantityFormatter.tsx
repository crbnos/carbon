import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";

const MAXIMUM_FRACTION_DIGITS = 2;
const SMALLEST_DISPLAYABLE_QUANTITY = 0.01;

/**
 * Formats a quantity for display at two decimals. This is presentation only —
 * the underlying quantity is never rounded, so BOMs, costing, reports, exports
 * and the API keep the exact value.
 *
 * - Whole numbers stay whole: `3` renders as "3", not "3.00".
 * - A non-zero quantity too small to render at two decimals shows as "<0.01"
 *   rather than a misleading "0".
 */
export function formatQuantityForDisplay(
  quantity: number,
  formatter: Intl.NumberFormat
) {
  if (!Number.isFinite(quantity)) return "";

  if (quantity !== 0 && Math.abs(quantity) < SMALLEST_DISPLAYABLE_QUANTITY) {
    // Format the signed threshold rather than prepending "-": locales differ on
    // the negative sign (sv/fi/nb use U+2212, ar/fa add a directional mark).
    return quantity > 0
      ? `<${formatter.format(SMALLEST_DISPLAYABLE_QUANTITY)}`
      : `>${formatter.format(-SMALLEST_DISPLAYABLE_QUANTITY)}`;
  }

  return formatter.format(quantity);
}

export function useQuantityFormatter() {
  const { locale } = useLocale();

  return useMemo(() => {
    const formatter = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: MAXIMUM_FRACTION_DIGITS
    });

    return (quantity: number) => formatQuantityForDisplay(quantity, formatter);
  }, [locale]);
}
