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
import { path } from "~/utils/path";
import { scheduleRows, toContractLineTerms } from "./contractTerms";
import type { Contract, ContractLine, ContractRouteData } from "./types";

type ContractSummaryProps = Pick<
  ContractRouteData,
  "contract" | "lines" | "schedule" | "computedSchedule"
>;

/** The contract at a glance, laid out like the rental agreement summary: its
 *  lines as one sentence each, then the recurring value per billing period,
 *  the next invoice and the contract value. */
const ContractSummary = ({
  contract,
  lines,
  schedule,
  computedSchedule
}: ContractSummaryProps) => {
  const { t } = useLingui();
  const today = useCompanyToday();
  const currencyCode = contract.currencyCode ?? "USD";
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const frequency = contract.billingFrequency ?? "Month";

  // Σ the schedule — planned live for an unedited Draft, else persisted.
  const contractValue = scheduleRows({
    computedSchedule,
    schedule,
    credits: []
  }).reduce((sum, row) => sum + row.amount, 0);

  // A contract that has not started yet is valued on its start date, when
  // its lines first bill.
  const startDate = contract.startDate ?? today;
  const recurring = lines.some((line) => line.revenueType === "Recurring")
    ? recurringValuePerPeriod(
        lines.map(toContractLineTerms),
        frequency,
        today < startDate ? startDate : today
      )
    : null;
  const recurringLabel: Record<typeof frequency, string> = {
    Week: t`Recurring per week:`,
    Month: t`Recurring per month:`,
    Quarter: t`Recurring per quarter:`,
    Year: t`Recurring per year:`
  };

  // A line an amendment replaced keeps its history but no longer bills past
  // its end date.
  const replaced = new Set(
    lines
      .map((line) => line.amendsLineId)
      .filter((lineId): lineId is string => Boolean(lineId))
  );

  const nextInvoice = nextPlannedInvoice({ computedSchedule, schedule });
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
              No lines yet. Add a service line before confirming the contract.
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
              />
            ))}
          </VStack>
        )}

        <VStack spacing={2} className="mt-8">
          {recurring !== null && (
            <HStack className="justify-between text-sm text-muted-foreground w-full">
              <span>{recurringLabel[frequency]}</span>
              <MotionMoney
                value={recurring}
                currency={currencyCode}
                decimalPlaces={currencyDecimals}
              />
            </HStack>
          )}
          <HStack className="justify-between text-sm text-muted-foreground w-full">
            <span>
              <Trans>Next Invoice:</Trans>
            </span>
            {nextInvoice ? (
              <span className="flex items-center gap-2">
                <DateTime value={nextInvoice.invoiceDate} variant="date" />
                <span aria-hidden>·</span>
                <MotionMoney
                  value={nextInvoice.total}
                  currency={currencyCode}
                  decimalPlaces={currencyDecimals}
                />
              </span>
            ) : (
              <span>—</span>
            )}
          </HStack>
          <div className="h-px bg-border my-2 w-full" />
          <HStack className="justify-between text-xl font-semibold w-full">
            <span>
              <Trans>Contract Value:</Trans>
            </span>
            <MotionMoney
              value={contractValue}
              currency={currencyCode}
              decimalPlaces={currencyDecimals}
            />
          </HStack>
          {!contract.endDate && (
            <p className="text-xs text-muted-foreground w-full">
              <Trans>
                Open-ended: the value of the invoices planned so far.
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

/** "Platform access · 10 × $40.00 per month · 20% off until 31 Oct 2027". */
function SummaryLine({
  contract,
  line,
  currencyCode,
  isReplaced
}: {
  contract: Contract;
  line: ContractLine;
  currencyCode: string;
  isReplaced: boolean;
}) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const formatQuantity = useQuantityFormatter();
  const percent = usePercentFormatter();
  const rateFormatter = useCurrencyFormatter({
    currency: currencyCode,
    rate: true
  });

  const name = line.description || line.item?.name || line.itemId;
  const quantity = Number(line.quantity);
  const rate = rateFormatter.format(Number(line.rate));
  const discount = Number(line.discountPercent);
  const perUnit: Record<NonNullable<ContractLine["rateUnit"]>, string> = {
    Day: t`per day`,
    Week: t`per week`,
    Month: t`per month`,
    Quarter: t`per quarter`,
    Year: t`per year`
  };

  const segments: string[] = [];
  if (line.revenueType === "One-time") {
    segments.push(t`one-time`);
    segments.push(
      quantity === 1 ? rate : `${formatQuantity(quantity)} × ${rate}`
    );
  } else {
    const per = line.rateUnit ? ` ${perUnit[line.rateUnit]}` : "";
    segments.push(`${formatQuantity(quantity)} × ${rate}${per}`);
  }
  if (discount > 0) {
    const off = percent.format(discount);
    segments.push(
      line.discountEndsOn
        ? t`${off} off until ${formatDate(line.discountEndsOn)}`
        : t`${off} off`
    );
  }
  // A line that stops before the contract does (an amendment replaced it, or
  // it was signed for less).
  if (line.endDate && line.endDate !== contract.endDate) {
    segments.push(t`until ${formatDate(line.endDate)}`);
  }

  return (
    <div className="border-b border-input py-3 w-full min-w-0">
      <p className="text-sm">
        <Link
          to={path.to.contractLine(contract.id!, line.id)}
          className={cn(
            "font-medium hover:underline",
            isReplaced && "line-through text-muted-foreground"
          )}
        >
          {name}
        </Link>
        <span className="text-muted-foreground">
          {segments.map((segment) => ` · ${segment}`).join("")}
        </span>
      </p>
    </div>
  );
}

/** The first invoice still to be drafted, with its total. */
function nextPlannedInvoice({
  computedSchedule,
  schedule
}: Pick<ContractSummaryProps, "computedSchedule" | "schedule">): {
  invoiceDate: string;
  total: number;
} | null {
  if (computedSchedule) {
    const next = computedSchedule.find(
      (invoice) => invoice.status === "Planned"
    );
    return next
      ? {
          invoiceDate: next.invoiceDate,
          total: next.rows.reduce((sum, row) => sum + row.amount, 0)
        }
      : null;
  }
  const next = schedule.find((invoice) => invoice.status === "Planned");
  return next
    ? {
        invoiceDate: next.invoiceDate,
        total: next.customerContractInvoiceLine.reduce(
          (sum, row) => sum + Number(row.amount),
          0
        )
      }
    : null;
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
