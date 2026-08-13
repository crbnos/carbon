import { moneyFormatOptions } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import MotionNumber from "motion-number";
import { useCurrencyMinDecimals } from "~/hooks/useCurrencies";

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
  className
}: MotionMoneyProps) => {
  const { locale } = useLocale();
  const minDecimals = useCurrencyMinDecimals();

  return (
    <MotionNumber
      value={value}
      format={{
        ...moneyFormatOptions(decimalPlaces, {
          currency,
          minDecimalPlaces: minDecimals
        }),
        notation: "standard" as const
      }}
      locales={locale}
      className={className}
    />
  );
};

export default MotionMoney;
