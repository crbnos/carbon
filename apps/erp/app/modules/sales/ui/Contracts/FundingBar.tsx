// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { BarProgress, cn } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import ContractMoney from "./ContractMoney";

export type ContractLineFundingPosition = {
  billed: number;
  unbilled: number;
  incurred: number;
};

export type ContractLineFundingTerms = {
  fundedAmount: number | null;
  fundedCost: number | null;
  ceilingAmount: number | null;
  noticePercent: number;
};

/**
 * Where a billing line stands against its funding. Billing (billed, then
 * unbilled) fills the funded amount, where invoicing stops; cost incurred
 * fills the funded cost, with a mark at the notice percent (FAR
 * 52.232-20/-22 compare cost, not billing). `compact` draws the billing bar
 * alone, for a list row.
 */
export default function FundingBar({
  position,
  terms,
  currencyCode,
  compact = false
}: {
  position: ContractLineFundingPosition;
  terms: ContractLineFundingTerms;
  currencyCode: string;
  compact?: boolean;
}) {
  const { t } = useLingui();
  const billed = Number(position.billed);
  const unbilled = Number(position.unbilled);
  const incurred = Number(position.incurred);
  const fundedAmount =
    terms.fundedAmount === null ? null : Number(terms.fundedAmount);
  const fundedCost =
    terms.fundedCost === null ? null : Number(terms.fundedCost);
  const noticePercent = Number(terms.noticePercent);

  // With no funded amount the bar shows billed against everything billable.
  const billingMax = Math.max(fundedAmount ?? 0, billed + unbilled, 1);
  const costMax = Math.max(fundedCost ?? 0, incurred, 1);
  const noticeAt =
    fundedCost !== null && fundedCost > 0
      ? (noticePercent * fundedCost) / costMax
      : null;
  const pastNotice =
    fundedCost !== null &&
    fundedCost > 0 &&
    incurred >= noticePercent * fundedCost;

  const billingBar = (
    <BarProgress
      progress={billed + unbilled}
      max={billingMax}
      label={compact ? undefined : t`Billing`}
      segments={[
        { value: billed, className: "bg-emerald-500" },
        { value: unbilled, className: "bg-blue-500" }
      ]}
    />
  );
  if (compact) return billingBar;

  return (
    <div className="@container flex w-full flex-col gap-4">
      <div className="grid w-full grid-cols-2 gap-x-8 gap-y-3 text-sm @md:grid-cols-3">
        <Figure label={t`Billed`} swatch="bg-emerald-500">
          <ContractMoney value={billed} currencyCode={currencyCode} />
        </Figure>
        <Figure label={t`Unbilled`} swatch="bg-blue-500">
          <ContractMoney value={unbilled} currencyCode={currencyCode} />
        </Figure>
        <Figure label={t`Funded Amount`}>
          <ContractMoney value={fundedAmount} currencyCode={currencyCode} />
        </Figure>
        <Figure label={t`Cost Incurred`} swatch="bg-foreground/70">
          <ContractMoney value={incurred} currencyCode={currencyCode} />
        </Figure>
        <Figure label={t`Funded Cost`}>
          <ContractMoney value={fundedCost} currencyCode={currencyCode} />
        </Figure>
        {terms.ceilingAmount !== null && (
          <Figure label={t`Ceiling`}>
            <ContractMoney
              value={terms.ceilingAmount}
              currencyCode={currencyCode}
            />
          </Figure>
        )}
      </div>
      {billingBar}
      <div className="relative w-full">
        <BarProgress
          progress={incurred}
          max={costMax}
          label={t`Cost`}
          activeClassName={pastNotice ? "bg-amber-500" : "bg-foreground/70"}
        />
        {noticeAt !== null && (
          <span
            aria-hidden="true"
            className="absolute bottom-0 h-[18px] w-px bg-amber-500"
            style={{ left: `${Math.min(noticeAt, 1) * 100}%` }}
          />
        )}
      </div>
      {noticeAt !== null && (
        <p
          className={cn(
            "text-xs",
            pastNotice
              ? "text-amber-600 dark:text-amber-400"
              : "text-muted-foreground"
          )}
        >
          {pastNotice ? (
            <Trans>Cost incurred is past the notice point.</Trans>
          ) : (
            <Trans>The mark is the notice point on the funded cost.</Trans>
          )}
        </p>
      )}
    </div>
  );
}

function Figure({
  label,
  swatch,
  children
}: {
  label: string;
  swatch?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {swatch && (
          <span
            aria-hidden="true"
            className={cn("size-2 shrink-0 rounded-[2px]", swatch)}
          />
        )}
        {label}
      </span>
      <span className="truncate font-medium">{children}</span>
    </div>
  );
}
