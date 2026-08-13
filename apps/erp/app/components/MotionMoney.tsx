import { moneyFormatOptionsFor } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import MotionNumber from "motion-number";

type MotionMoneyProps = {
  value: number;
  currency: string;
  /** The document currency's configured `currency.decimalPlaces` — resolve it
   *  once per component with `useCurrencyDecimals` and pass it down, rather
   *  than calling that hook per amount (it mounts a fetcher). */
  decimalPlaces: number;
  className?: string;
};

/**
 * An animated settlement amount. MotionNumber takes a STATIC `format` object,
 * so it cannot apply the money kind's zero case (a plain 0 renders "$0") on its
 * own — this picks the options per value, which is why the document summaries
 * render money through here instead of sharing one options object.
 *
 * MotionNumber also narrows `notation` out of `Intl.NumberFormatOptions`, hence
 * the explicit value.
 */
const MotionMoney = ({
  value,
  currency,
  decimalPlaces,
  className
}: MotionMoneyProps) => {
  const { locale } = useLocale();

  return (
    <MotionNumber
      value={value}
      format={{
        ...moneyFormatOptionsFor(value, currency, decimalPlaces),
        notation: "standard" as const
      }}
      locales={locale}
      className={className}
    />
  );
};

export default MotionMoney;
