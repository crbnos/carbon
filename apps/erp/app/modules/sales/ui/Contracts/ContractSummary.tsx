// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  HStack,
  VStack
} from "@carbon/react";
import { recurringValuePerPeriod } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { CustomerAvatar, DateTime, MotionMoney } from "~/components";
import {
  useCompanyToday,
  useCurrencyDecimals,
  useCurrencyFormatter,
  useDateFormatter,
  usePercentFormatter,
  useQuantityFormatter
} from "~/hooks";
import { useGovernmentContracting } from "~/modules/projects/ui/useGovernmentContracting";
import { path } from "~/utils/path";
import {
  isProjectBillingMethod,
  projectContractFunded
} from "../../sales.models";
import { untaxedContractInvoices } from "../../sales.utils";
import { useBillingMethodLabels } from "./ContractLineBillingFields";
import { scheduleRows, toContractLineTerms } from "./contractTerms";
import type { Contract, ContractLine, ContractRouteData } from "./types";

type ContractSummaryProps = Pick<
  ContractRouteData,
  "contract" | "lines" | "schedule" | "computedSchedule" | "plannedInvoices"
>;

/** The contract at a glance: its lines, each with its amount in a right-hand
 *  column, then the recurring value per billing period, the next invoice and
 *  the contract value in the same column. A project contract shows what it is
 *  funded for instead: its Time & Materials and Cost Plus lines bill from
 *  project cost, so the schedule holds only its billing events. */
const ContractSummary = ({
  contract,
  lines,
  schedule,
  computedSchedule,
  plannedInvoices
}: ContractSummaryProps) => {
  const { t } = useLingui();
  const today = useCompanyToday();
  const { currencyCode } = contract;
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const frequency = contract.billingFrequency ?? "Month";
  const isProject = contract.billingBasis === "Project";
  const hasFixedLine = lines.some((line) => line.billingMethod === "Fixed");

  // Σ the schedule — planned live for an unedited Draft, else persisted.
  const contractValue = scheduleRows({
    computedSchedule,
    schedule,
    credits: []
  }).reduce((sum, row) => sum + row.amount, 0);

  // A contract that has not started yet is valued on its start date, and
  // one whose recurring lines all start later is valued when the first of
  // them starts — on any earlier day nothing bills, and the value reads 0.
  const startDate = contract.startDate ?? today;
  const valueFrom = today < startDate ? startDate : today;
  const firstRecurringStart = lines
    .filter(
      (line) =>
        line.revenueType === "Recurring" &&
        (!line.endDate || line.endDate >= valueFrom)
    )
    .map((line) => line.startDate)
    .sort()[0];
  const recurring = lines.some((line) => line.revenueType === "Recurring")
    ? recurringValuePerPeriod(
        lines.map(toContractLineTerms),
        frequency,
        firstRecurringStart && firstRecurringStart > valueFrom
          ? firstRecurringStart
          : valueFrom
      )
    : null;
  const recurringLabel: Record<typeof frequency, string> = {
    Week: t`Recurring per week`,
    Month: t`Recurring per month`,
    Quarter: t`Recurring per quarter`,
    Year: t`Recurring per year`
  };

  // A line an amendment replaced keeps its history but no longer bills past
  // its end date.
  const replaced = new Set(
    lines
      .map((line) => line.amendsLineId)
      .filter((lineId): lineId is string => Boolean(lineId))
  );

  // The next invoice to be drafted, priced and taxed on the server as the
  // drafted invoice will be; when the tax codes could not be read, the
  // schedule's net alone.
  const nextInvoice = plannedInvoices?.[0] ?? null;
  const nextNet = plannedInvoices
    ? nextInvoice
    : (untaxedContractInvoices({ computedSchedule, invoices: schedule })[0] ??
      null);
  const automation = automationText(contract);

  return (
    <Card>
      <CardHeader>
        <HStack className="justify-between items-center">
          <div className="flex flex-col gap-1 min-w-0">
            <CardTitle className="truncate">
              {contract.customerContractId}
            </CardTitle>
          </div>
          <div className="flex flex-col gap-1 items-end shrink-0">
            <CustomerAvatar customerId={contract.customerId ?? null} />
            <span className="text-xs text-muted-foreground tracking-tight">
              <DateTime value={contract.startDate} variant="date" />
              {" – "}
              {contract.endDate ? (
                <DateTime value={contract.endDate} variant="date" />
              ) : (
                <Trans>Open-ended</Trans>
              )}
            </span>
          </div>
        </HStack>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>
              No lines yet. Add a line before confirming the contract.
            </Trans>
          </p>
        ) : (
          <VStack spacing={0} className="w-full overflow-hidden">
            {lines.map((line) => (
              <SummaryLine
                key={line.id}
                contract={contract}
                line={line}
                currencyCode={currencyCode}
                isReplaced={replaced.has(line.id)}
                taxPercent={nextInvoice?.taxPercents[line.id]}
              />
            ))}
          </VStack>
        )}

        <VStack spacing={2} className="mt-6">
          {recurring !== null && (
            <HStack className="w-full justify-between text-sm text-muted-foreground">
              <span>{recurringLabel[frequency]}</span>
              <MotionMoney
                className="tabular-nums"
                value={recurring}
                currency={currencyCode}
                decimalPlaces={currencyDecimals}
              />
            </HStack>
          )}
          {(!isProject || hasFixedLine) && (
            <>
              <HStack className="w-full justify-between text-sm text-muted-foreground">
                <span>
                  {isProject ? (
                    <Trans>Next billing event</Trans>
                  ) : (
                    <Trans>Next invoice</Trans>
                  )}
                  {nextNet && (
                    <>
                      {" · "}
                      <DateTime value={nextNet.invoiceDate} variant="date" />
                    </>
                  )}
                </span>
                {nextNet ? (
                  <MotionMoney
                    className="tabular-nums"
                    value={nextNet.net}
                    currency={currencyCode}
                    decimalPlaces={currencyDecimals}
                  />
                ) : (
                  <span>—</span>
                )}
              </HStack>
              {plannedInvoices === null && nextNet && (
                <p className="w-full text-xs text-muted-foreground">
                  <Trans>Excludes tax: the tax codes could not be read.</Trans>
                </p>
              )}
              {nextInvoice && (
                <>
                  <HStack className="w-full justify-between text-sm text-muted-foreground">
                    <span>
                      <Trans>Tax</Trans>
                    </span>
                    <MotionMoney
                      className="tabular-nums"
                      value={nextInvoice.tax}
                      currency={currencyCode}
                      decimalPlaces={currencyDecimals}
                    />
                  </HStack>
                  <HStack className="w-full justify-between text-sm text-muted-foreground">
                    <span>
                      {isProject ? (
                        <Trans>Next billing event total</Trans>
                      ) : (
                        <Trans>Next invoice total</Trans>
                      )}
                    </span>
                    <MotionMoney
                      className="tabular-nums"
                      value={nextInvoice.net + nextInvoice.tax}
                      currency={currencyCode}
                      decimalPlaces={currencyDecimals}
                    />
                  </HStack>
                </>
              )}
            </>
          )}
          <div className="my-2 h-px w-full bg-border" />
          <HStack className="w-full justify-between text-lg font-semibold">
            <span>
              {isProject ? (
                <Trans>Funded</Trans>
              ) : (
                <Trans>Contract value</Trans>
              )}
            </span>
            <MotionMoney
              className="tabular-nums"
              value={isProject ? projectContractFunded(lines) : contractValue}
              currency={currencyCode}
              decimalPlaces={currencyDecimals}
            />
          </HStack>
          {!isProject && !contract.endDate && (
            <p className="text-xs text-muted-foreground w-full">
              <Trans>
                No end date: the value of the invoices planned so far. A new
                invoice is added every billing period.
              </Trans>
            </p>
          )}
          {automation && (
            <p className="text-xs text-muted-foreground w-full">{automation}</p>
          )}
        </VStack>
      </CardContent>
    </Card>
  );
};

/** One line: its name and terms on the left ("Recurring · 10 × $40.00 ·
 *  20% off until Oct 31, 2027"), what it bills on the right ("$320.00 per
 *  month"), so every amount sits in one column above the totals. */
function SummaryLine({
  contract,
  line,
  currencyCode,
  isReplaced,
  taxPercent
}: {
  contract: Contract;
  line: ContractLine;
  currencyCode: string;
  isReplaced: boolean;
  /** The line's rate on the next invoice, from the server; none when the
   *  line is not on it. */
  taxPercent: number | undefined;
}) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const formatQuantity = useQuantityFormatter();
  const percent = usePercentFormatter();
  const money = useCurrencyFormatter({ currency: currencyCode });
  const rateFormatter = useCurrencyFormatter({
    currency: currencyCode,
    rate: true
  });

  const name = line.description || line.item?.name || line.itemId;
  const quantity = Number(line.quantity);
  const rate = Number(line.rate);
  const discount = Number(line.discountPercent);
  // What the line bills once (One-time) or per its rate unit (Recurring),
  // after its discount — display only, rounded by the formatter.
  const amount = quantity * rate * (1 - discount);
  const perUnit: Record<NonNullable<ContractLine["rateUnit"]>, string> = {
    Day: t`per day`,
    Week: t`per week`,
    Month: t`per month`,
    Quarter: t`per quarter`,
    Year: t`per year`
  };
  const isRecurring = line.revenueType === "Recurring";
  const isProject = contract.billingBasis === "Project";
  const billingMethodLabels = useBillingMethodLabels(contract.billingBasis);
  const isBillingLine = isProjectBillingMethod(line.billingMethod);
  const isGovernmentContracting = useGovernmentContracting();
  const taxRate = percent.format(taxPercent ?? 0);

  // A project contract line: its CLIN (government contracting only) and
  // billing method; a billing line's amount is what it is funded for, a Fixed
  // Price line's is its price.
  const details: string[] = isProject
    ? [
        isGovernmentContracting ? line.lineItemNumber : null,
        billingMethodLabels[line.billingMethod]
      ].filter((part): part is string => !!part)
    : [isRecurring ? t`Recurring` : t`One-time`];
  // A project contract line is quantity 1 unless it names a part: then the
  // quantity is the units to deliver, at the rate per unit (Fixed Price).
  if (quantity !== 1) {
    details.push(
      isProject && isBillingLine
        ? t`${formatQuantity(quantity)} units`
        : `${formatQuantity(quantity)} × ${rateFormatter.format(rate)}`
    );
  }
  if (discount > 0) {
    const off = percent.format(discount);
    details.push(
      line.discountEndsOn
        ? t`${off} off until ${formatDate(line.discountEndsOn)}`
        : t`${off} off`
    );
  }
  // A recurring line that stops before the contract does (an amendment
  // replaced it, or it was signed for less). A one-time fee has no end to
  // speak of — its dates only spread its revenue.
  if (isRecurring && line.endDate && line.endDate !== contract.endDate) {
    details.push(t`until ${formatDate(line.endDate)}`);
  }

  return (
    <div className="flex w-full min-w-0 items-start justify-between gap-6 border-b border-input py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Link
          to={path.to.contractLine(contract.id!, line.id)}
          className={cn(
            "truncate text-sm font-medium hover:underline",
            isReplaced && "line-through text-muted-foreground"
          )}
        >
          {name}
        </Link>
        <span className="text-xs text-muted-foreground">
          {details.join(" · ")}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        <span
          className={cn(
            "text-sm font-medium tabular-nums",
            isReplaced && "line-through text-muted-foreground"
          )}
        >
          {isBillingLine
            ? line.fundedAmount === null
              ? "—"
              : money.format(Number(line.fundedAmount))
            : money.format(amount)}
        </span>
        {isBillingLine && line.fundedAmount !== null && (
          <span className="text-xs text-muted-foreground">
            <Trans>funded</Trans>
          </span>
        )}
        {isRecurring && line.rateUnit && (
          <span className="text-xs text-muted-foreground">
            {perUnit[line.rateUnit]}
          </span>
        )}
        {taxPercent !== undefined && taxPercent > 0 && (
          <span className="text-xs text-muted-foreground">
            {t`${taxRate} tax`}
          </span>
        )}
      </div>
    </div>
  );
}

/** What happens to an Active contract's invoices once drafted, under its
 *  effective invoicing setting. Nothing when they stay drafts for review. */
function automationText(contract: Contract): ReactNode {
  if (contract.status !== "Active") return null;
  switch (contract.effectiveInvoiceAutomation) {
    case "Post":
      return <Trans>Invoices are drafted and posted automatically.</Trans>;
    case "Post and Email":
      return (
        <Trans>Invoices are drafted, posted and emailed automatically.</Trans>
      );
    case "Post and Send via Stripe":
      return (
        <Trans>
          Invoices are drafted, posted and sent via Stripe automatically.
        </Trans>
      );
    default:
      return null;
  }
}

export default ContractSummary;
