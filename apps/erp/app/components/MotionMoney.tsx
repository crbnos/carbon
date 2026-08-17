import { moneyFormatOptions, SCALE } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import MotionNumber from "motion-number";
import { useMemo } from "react";
import { useCurrencyMinDecimals } from "~/hooks/useCurrencies";

type MotionMoneyProps = {
  value: number;
  currency: string;
  /** The document currency's configured `currency.decimalPlaces` — resolve it
   *  once per component with `useCurrencyDecimals` and pass it down, rather
   *  than calling that hook per amount (it mounts a fetcher). */
  decimalPlaces: number;
  /** A per-unit RATE ("Unit Price") rather than a settlement amount ("Total",
   *  "Subtotal", "Tax"). Still pads to the currency's decimals, but they
   *  become a floor, not a ceiling — see priceFormatOptions in the same doc. */
  rate?: boolean;
  className?: string;
};

/**
 * An animated currency amount. Exists so the document summaries name the kind
 * once instead of each spreading their own options object, and so the currency
 * and its decimals always travel together.
 *
 * MotionNumber narrows `notation` out of `Intl.NumberFormatOptions`, hence the
 * explicit value.
 */
const MotionMoney = ({
  value,
  currency,
  decimalPlaces,
  rate,
  className
}: MotionMoneyProps) => {
  const { locale } = useLocale();
  const minDecimals = useCurrencyMinDecimals();

  // MotionNumber memoizes its formatted parts on `format` BY REFERENCE, so a
  // fresh literal every render re-derives every digit and re-drives framer's
  // layout projection on each one.
  const format = useMemo(
    () => ({
      ...moneyFormatOptions(decimalPlaces, {
        currency,
        minDecimalPlaces: minDecimals,
        maxDecimalPlaces: rate ? Math.max(decimalPlaces, SCALE) : undefined
      }),
      notation: "standard" as const
    }),
    [currency, decimalPlaces, minDecimals, rate]
  );

  return (
    <MotionNumber
      // MotionNumber animates a VALUE change; a FORMAT change is not one. Losing
      // the trailing zeros drops three parts, and AnimatePresence's popLayout
      // pulls them out absolutely-positioned over a one-second fade — the ".00"
      // ghosting on top of the amount when the trailing-zeros setting is toggled.
      // Keying on the format remounts instead, so re-formatting is instant and
      // only real value changes animate.
      key={`${locale}:${currency}:${decimalPlaces}:${minDecimals}:${rate}`}
      value={value}
      format={format}
      locales={locale}
      className={className}
    />
  );
};

export default MotionMoney;
