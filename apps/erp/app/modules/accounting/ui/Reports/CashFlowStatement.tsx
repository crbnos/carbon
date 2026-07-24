import { cn, ScrollArea } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";
import type { CashFlowStatement as CashFlow, CashFlowLine } from "../../types";

type CashFlowStatementProps = {
  statement: CashFlow;
  startDate: string | null;
  endDate: string | null;
  // Consolidated mode: the parent currency the statement is expressed in.
  currencyCode?: string | null;
  // Consolidated lines omit the company filter on drill-down.
  includeCompanyFilter?: boolean;
};

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

const CashFlowStatement = ({
  statement,
  startDate,
  endDate,
  currencyCode
}: CashFlowStatementProps) => {
  const { t } = useLingui();

  const windowParams = (accountId?: string) => {
    const params = new URLSearchParams();
    if (accountId) params.set("accountId", accountId);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  };

  const AmountLink = ({
    accountId,
    amount
  }: {
    accountId: string;
    amount: number;
  }) => (
    <Link
      to={`${path.to.generalLedger}${windowParams(accountId)}`}
      className="tabular-nums text-muted-foreground hover:text-foreground hover:underline"
    >
      {formatCurrency(amount)}
    </Link>
  );

  const LineRow = ({ line }: { line: CashFlowLine }) => (
    <div className="flex items-center h-8 px-4 text-sm hover:bg-accent">
      <span className="flex-1 flex items-center gap-2 truncate">
        {line.number && (
          <span className="text-muted-foreground shrink-0">{line.number}</span>
        )}
        <span className="truncate">{line.name}</span>
      </span>
      <span className="w-40 text-right">
        <AmountLink accountId={line.accountId} amount={line.amount} />
      </span>
    </div>
  );

  const SubtotalRow = ({
    label,
    amount
  }: {
    label: string;
    amount: number;
  }) => (
    <div className="flex items-center h-9 px-4 text-sm font-semibold border-t border-border">
      <span className="flex-1">{label}</span>
      <span className="w-40 text-right tabular-nums">
        {formatCurrency(amount)}
      </span>
    </div>
  );

  const SectionHeader = ({ label }: { label: string }) => (
    <div className="flex items-center h-9 px-4 text-sm font-semibold bg-muted/40 border-t border-border">
      {label}
    </div>
  );

  return (
    <ScrollArea className="h-[calc(100dvh-var(--header-height)-61px)] w-full">
      <div className="max-w-3xl mx-auto py-4">
        <div className="flex items-center justify-between px-4 pb-2">
          <h2 className="text-base font-semibold">
            <Trans>Statement of Cash Flows</Trans>
          </h2>
          {currencyCode && (
            <span className="text-sm text-muted-foreground">
              {currencyCode}
            </span>
          )}
        </div>

        {/* Operating */}
        <SectionHeader label={t`Operating Activities`} />
        <div className="flex items-center h-8 px-4 text-sm hover:bg-accent">
          <span className="flex-1">
            <Link
              to={`${path.to.incomeStatement}${windowParams()}`}
              className="hover:text-foreground hover:underline"
            >
              <Trans>Net Income</Trans>
            </Link>
          </span>
          <span className="w-40 text-right tabular-nums text-muted-foreground">
            {formatCurrency(statement.netIncome)}
          </span>
        </div>
        {statement.operating.map((line) => (
          <LineRow key={line.accountId} line={line} />
        ))}
        <SubtotalRow
          label={t`Net cash from operating activities`}
          amount={statement.operatingTotal}
        />

        {/* Investing */}
        <SectionHeader label={t`Investing Activities`} />
        {statement.investing.map((line) => (
          <LineRow key={line.accountId} line={line} />
        ))}
        <SubtotalRow
          label={t`Net cash from investing activities`}
          amount={statement.investingTotal}
        />

        {/* Financing */}
        <SectionHeader label={t`Financing Activities`} />
        {statement.financing.map((line) => (
          <LineRow key={line.accountId} line={line} />
        ))}
        <SubtotalRow
          label={t`Net cash from financing activities`}
          amount={statement.financingTotal}
        />

        {/* Unclassified — only when non-empty */}
        {statement.unclassified.length > 0 && (
          <>
            <div className="flex items-center gap-2 h-9 px-4 text-sm font-semibold bg-amber-500/10 border-t border-border text-amber-700 dark:text-amber-500">
              <LuTriangleAlert className="h-4 w-4 shrink-0" />
              <span>
                {t`${statement.unclassified.length} accounts have no cash flow activity — set an account type or override`}
              </span>
            </div>
            {statement.unclassified.map((line) => (
              <LineRow key={line.accountId} line={line} />
            ))}
            <SubtotalRow
              label={t`Net cash from unclassified activities`}
              amount={statement.unclassifiedTotal}
            />
          </>
        )}

        {/* Effect of exchange rate changes (consolidated) */}
        {statement.effectOfExchangeRates !== undefined && (
          <SubtotalRow
            label={t`Effect of exchange rate changes on cash`}
            amount={statement.effectOfExchangeRates}
          />
        )}

        {/* Cash reconciliation footer */}
        <div className="mt-2">
          <SubtotalRow
            label={t`Net change in cash`}
            amount={statement.netChangeInCash}
          />
          <div className="flex items-center h-8 px-4 text-sm">
            <span className="flex-1 text-muted-foreground">
              <Trans>Cash at beginning of period</Trans>
            </span>
            <span className="w-40 text-right tabular-nums text-muted-foreground">
              {formatCurrency(statement.beginningCash)}
            </span>
          </div>
          <SubtotalRow
            label={t`Cash at end of period`}
            amount={statement.endingCash}
          />
        </div>

        {/* Unreconciled difference — only when the identity fails */}
        {statement.unreconciledDifference !== 0 && (
          <div
            className={cn(
              "flex items-center h-9 px-4 mt-2 text-sm font-semibold",
              "bg-destructive/10 text-destructive border-t border-border"
            )}
          >
            <span className="flex-1">
              <Trans>Unreconciled difference</Trans>
            </span>
            <span className="w-40 text-right tabular-nums">
              {formatCurrency(statement.unreconciledDifference)}
            </span>
          </div>
        )}
      </div>
    </ScrollArea>
  );
};

export default CashFlowStatement;
