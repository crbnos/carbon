import { useCurrencyFormatter } from "~/hooks";

type RentalMoneyProps = {
  value: number | null | undefined;
  currencyCode?: string | null;
  /** A per-unit rate (day / week / month tier) rather than a settled amount. */
  rate?: boolean;
};

/** An agreement amount in the agreement's own currency. A component rather
 *  than a formatter call so table cells in different currencies can each use
 *  the hook. */
const RentalMoney = ({ value, currencyCode, rate }: RentalMoneyProps) => {
  const formatter = useCurrencyFormatter({
    currency: currencyCode ?? undefined,
    rate
  });
  if (value === null || value === undefined) return <span>—</span>;
  return (
    <span className="tabular-nums">{formatter.format(Number(value))}</span>
  );
};

export default RentalMoney;
