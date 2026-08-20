import { cn } from "@carbon/react";
import type {
  ReportColumnGranularity,
  ReportPeriodBucket
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { memo, useEffect, useMemo, useRef } from "react";
import { useRealtime } from "~/hooks";
import type { ChartPeriodSeries } from "../../types";
import { computeExecutivePnl, type ExecutivePnlRowKey } from "./executivePnl";
import { getPeriodColumnLabel } from "./MultiPeriodStatementTree";

const ACCOUNT_COLUMN_WIDTH = 360;
const PERIOD_COLUMN_WIDTH = 128;

type ExecutivePnlSummaryProps = {
  /** Income-statement accounts (filtered to incomeBalance "Income Statement"). */
  data: ChartPeriodSeries[];
  periods: ReportPeriodBucket[];
  columns: ReportColumnGranularity;
  showTranslated?: boolean;
  parentCurrency?: string | null;
};

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "-";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

const ExecutivePnlSummary = memo(
  ({
    data,
    periods,
    columns,
    showTranslated = false,
    parentCurrency
  }: ExecutivePnlSummaryProps) => {
    const { t } = useLingui();
    const { locale } = useLocale();
    useRealtime("journal");
    const scrollRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLDivElement>(null);

    // Mirror the body's horizontal scroll onto the header so columns track.
    useEffect(() => {
      const element = scrollRef.current;
      if (!element) return;
      const sync = () => {
        if (headerRef.current)
          headerRef.current.scrollLeft = element.scrollLeft;
      };
      element.addEventListener("scroll", sync, { passive: true });
      return () => element.removeEventListener("scroll", sync);
    }, []);

    const rows = useMemo(
      () =>
        computeExecutivePnl(
          data,
          periods.map((bucket) => bucket.key),
          { showTranslated }
        ),
      [data, periods, showTranslated]
    );

    const labels: Record<ExecutivePnlRowKey, string> = {
      revenue: t`Revenue`,
      cogs: t`Cost of Sales`,
      grossProfit: t`Gross Profit`,
      operatingExpenses: t`Operating Expenses`,
      operatingIncome: t`Operating Income`,
      otherIncome: t`Other Income`,
      otherExpense: t`Other Expense`,
      tax: t`Income Tax`,
      netIncome: t`Net Income`
    };

    const percentFormatter = useMemo(
      () =>
        new Intl.NumberFormat(locale, {
          style: "percent",
          minimumFractionDigits: 1,
          maximumFractionDigits: 1
        }),
      [locale]
    );

    const rowWidth =
      ACCOUNT_COLUMN_WIDTH + periods.length * PERIOD_COLUMN_WIDTH + 16;

    return (
      <div className="flex h-[calc(100dvh-var(--header-height)-61px)] w-full flex-col">
        {/* Header viewport — scrollLeft is mirrored from the body below */}
        <div ref={headerRef} className="shrink-0 overflow-x-hidden">
          <div
            className="flex h-12 items-center border-b border-border bg-card pr-4 text-sm font-medium text-foreground/80"
            style={{ minWidth: rowWidth }}
          >
            <div
              className="sticky left-0 z-[2] flex h-full shrink-0 items-center bg-card px-4"
              style={{ width: ACCOUNT_COLUMN_WIDTH }}
            >
              <Trans>Executive P&amp;L</Trans>
            </div>
            {periods.map((bucket) => (
              <div
                key={bucket.key}
                className="flex shrink-0 flex-col items-end justify-center px-2 text-right"
                style={{ width: PERIOD_COLUMN_WIDTH }}
              >
                <span className="whitespace-nowrap">
                  {getPeriodColumnLabel(bucket, columns, locale)}
                </span>
                {bucket.isPartial && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {t`To Date`}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-auto">
          <div style={{ minWidth: rowWidth }}>
            {rows.map((row) => (
              <div
                key={row.key}
                className={cn(
                  "flex h-9 items-center pr-4 text-sm",
                  row.isSubtotal && "font-semibold",
                  row.isSubtotal &&
                    !row.isBottomLine &&
                    "border-t border-border",
                  row.isBottomLine &&
                    "border-y-2 border-border bg-muted/40 font-semibold"
                )}
                style={{ minWidth: rowWidth }}
              >
                {/* Sticky label cell */}
                <div
                  className={cn(
                    "sticky left-0 z-[1] flex h-full shrink-0 items-center px-4",
                    row.isBottomLine ? "bg-muted/40" : "bg-card"
                  )}
                  style={{ width: ACCOUNT_COLUMN_WIDTH }}
                >
                  <span className="truncate">{labels[row.key]}</span>
                </div>

                {/* One cell per period bucket */}
                {periods.map((bucket) => {
                  const value = row.values[bucket.key] ?? 0;
                  const margin = row.margins?.[bucket.key];
                  return (
                    <div
                      key={bucket.key}
                      className="flex shrink-0 flex-col items-end justify-center px-2 text-right tabular-nums"
                      style={{ width: PERIOD_COLUMN_WIDTH }}
                    >
                      <span
                        className={cn(
                          !row.isSubtotal && "text-muted-foreground"
                        )}
                      >
                        {formatCurrency(value)}
                      </span>
                      {row.margins != null && (
                        <span className="text-xs font-normal text-muted-foreground">
                          {margin == null
                            ? "-"
                            : percentFormatter.format(margin)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {showTranslated && parentCurrency && (
          <div className="shrink-0 border-t border-border bg-card px-4 py-1.5 text-xs text-muted-foreground">
            <Trans>Showing in {parentCurrency}</Trans>
          </div>
        )}
      </div>
    );
  }
);

ExecutivePnlSummary.displayName = "ExecutivePnlSummary";
export default ExecutivePnlSummary;
