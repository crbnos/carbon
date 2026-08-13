import { SCALE, SCALE_FORMAT } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";

/** Smallest quantity the storage scale can represent. Below it a value is real
 *  but unrenderable, and "0" would be a lie. */
const SMALLEST_DISPLAYABLE_QUANTITY = 1 / 10 ** SCALE;

/**
 * Formats a quantity for display at full storage precision (up to five
 * decimals). Presentation only — the underlying quantity is never rounded, so
 * BOMs, costing, reports, exports and the API keep the exact value.
 *
 * - Whole numbers stay whole: `3` renders as "3", not "3.00000".
 * - A stored value renders itself: `0.00125`, not a placeholder.
 * - A non-zero quantity too small to render at all shows as "<0.00001" rather
 *   than a misleading "0".
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
    const formatter = new Intl.NumberFormat(locale, SCALE_FORMAT);

    return (quantity: number) => formatQuantityForDisplay(quantity, formatter);
  }, [locale]);
}
