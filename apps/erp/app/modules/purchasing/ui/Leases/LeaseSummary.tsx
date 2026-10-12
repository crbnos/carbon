// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { formatPercent, round } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ReactNode } from "react";
import { DateTime, SupplierAvatar } from "~/components";
import { LesseeClassificationBadge } from "./LeaseClassificationPreview";
import LeaseMoney from "./LeaseMoney";
import type {
  Lease,
  LeaseLine,
  LeasePayment,
  LeaseScheduleLine
} from "./types";
import { isScheduleLinePosted } from "./utils";

type LeaseSummaryProps = {
  lease: Lease;
  lines: LeaseLine[];
  payments: LeasePayment[];
  schedule: LeaseScheduleLine[];
};

function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm truncate">{children}</span>
    </div>
  );
}

/** The lease at a glance: its terms, its treatment, its assets' liability
 *  and net right-of-use asset as of the last posted lease run, and the next
 *  payment. */
const LeaseSummary = ({
  lease,
  lines,
  payments,
  schedule
}: LeaseSummaryProps) => {
  const { t } = useLingui();
  const { locale } = useLocale();
  const currencyCode = lease.currencyCode;

  // Each active, capitalized asset's balances after its last posted month.
  const recognized = lines.filter(
    (line) =>
      line.status === "Active" &&
      line.lesseeClassification !== null &&
      line.lesseeClassification !== "Short-Term"
  );
  let liability = 0;
  let netRou = 0;
  let initialLiability = 0;
  let lastPosted: string | null = null;
  for (const line of recognized) {
    const posted: LeaseScheduleLine[] = [];
    for (const row of schedule) {
      if (row.leaseLineId !== line.id) continue;
      if (!isScheduleLinePosted(row)) break;
      posted.push(row);
    }
    const last = posted[posted.length - 1];
    if (last && (!lastPosted || last.periodDate > lastPosted)) {
      lastPosted = last.periodDate;
    }
    initialLiability += Number(line.initialLiability ?? 0);
    liability += last
      ? Number(last.closingLiability)
      : Number(line.initialLiability ?? 0);
    netRou +=
      Number(line.rouAssetCost ?? 0) -
      posted.reduce((sum, row) => sum + Number(row.rouAmortization), 0);
  }
  liability = round(liability);
  netRou = round(netRou);
  const hasBalances = lease.status === "Active" && recognized.length > 0;

  // The next due date with a payment to bill, and every asset's payment on
  // it.
  const nextDueDate = payments.find(
    (payment) => payment.status === "Pending"
  )?.dueDate;
  const nextPaymentAmount = round(
    payments
      .filter(
        (payment) =>
          payment.status === "Pending" && payment.dueDate === nextDueDate
      )
      .reduce((sum, payment) => sum + Number(payment.amount), 0)
  );
  const frequency =
    lease.paymentFrequency === "Quarterly"
      ? t`per quarter`
      : lease.paymentFrequency === "Annual"
        ? t`per year`
        : t`per month`;
  const timing =
    lease.paymentTiming === "Arrears" ? t`in arrears` : t`in advance`;

  return (
    <Card>
      <CardHeader>
        <HStack className="justify-between items-start">
          <div className="flex flex-col gap-1 min-w-0">
            <CardTitle className="truncate">
              {lease.name || lease.leaseId}
            </CardTitle>
            {lease.description && (
              <CardDescription className="line-clamp-2">
                {lease.description}
              </CardDescription>
            )}
          </div>
          <div className="flex flex-col gap-1 items-end shrink-0">
            <SupplierAvatar supplierId={lease.supplierId ?? null} />
            <span className="text-xs text-muted-foreground tracking-tight whitespace-nowrap">
              <DateTime value={lease.commencementDate} variant="date" />
              {" – "}
              {lease.endDate ? (
                <DateTime value={lease.endDate} variant="date" />
              ) : (
                <Trans>Open-ended</Trans>
              )}
            </span>
          </div>
        </HStack>
      </CardHeader>
      <CardContent>
        <VStack spacing={4}>
          <div className="@container w-full">
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 @xl:grid-cols-4">
              <Fact label={<Trans>Assets</Trans>}>
                <span className="tabular-nums">{lines.length}</span>
              </Fact>
              <Fact label={<Trans>Payment</Trans>}>
                <LeaseMoney
                  value={lease.paymentAmount}
                  currencyCode={currencyCode}
                />{" "}
                <span className="text-muted-foreground">
                  {frequency}, {timing}
                </span>
              </Fact>
              <Fact label={<Trans>Annual Escalation</Trans>}>
                <span className="tabular-nums">
                  {formatPercent(
                    Number(lease.annualEscalationPercent ?? 0) / 100,
                    locale
                  )}
                </span>
              </Fact>
              {/* An open-ended lease is short-term: nothing is discounted. */}
              {lease.endDate && (
                <Fact label={<Trans>Discount Rate</Trans>}>
                  <span className="tabular-nums">
                    {formatPercent(
                      Number(lease.discountRate ?? 0) / 100,
                      locale
                    )}
                  </span>
                </Fact>
              )}
              <Fact label={<Trans>Treatment</Trans>}>
                {lease.classification === "Mixed" ? (
                  <Trans>Varies by asset</Trans>
                ) : lease.classification ? (
                  <LesseeClassificationBadge value={lease.classification} />
                ) : (
                  <span className="text-muted-foreground">
                    <Trans>Set at activation</Trans>
                  </span>
                )}
              </Fact>
              {lease.noticeDate && (
                <Fact label={<Trans>Notice Date</Trans>}>
                  <DateTime value={lease.noticeDate} variant="date" />
                </Fact>
              )}
            </div>
          </div>

          <div className="h-px bg-border w-full" />

          <VStack spacing={2}>
            {hasBalances && (
              <>
                <HStack className="justify-between text-sm text-muted-foreground w-full">
                  <span>
                    <Trans>Initial Liability:</Trans>
                  </span>
                  <LeaseMoney
                    value={initialLiability}
                    currencyCode={currencyCode}
                  />
                </HStack>
                <HStack className="justify-between text-sm text-muted-foreground w-full">
                  <span>
                    <Trans>Net Right-of-Use Asset:</Trans>
                  </span>
                  <LeaseMoney value={netRou} currencyCode={currencyCode} />
                </HStack>
                <HStack className="justify-between text-xl font-semibold w-full">
                  <span>
                    <Trans>Lease Liability:</Trans>
                  </span>
                  <LeaseMoney value={liability} currencyCode={currencyCode} />
                </HStack>
                <p className="text-xs text-muted-foreground w-full">
                  {lastPosted ? (
                    <Trans>
                      As of <DateTime value={lastPosted} variant="date" />, the
                      last month a lease run posted.
                    </Trans>
                  ) : (
                    <Trans>At commencement. No lease run has posted yet.</Trans>
                  )}
                </p>
                <div className="h-px bg-border my-2 w-full" />
              </>
            )}
            <HStack className="justify-between text-sm text-muted-foreground w-full">
              <span>
                <Trans>Next Payment:</Trans>
              </span>
              {nextDueDate ? (
                <span className="flex items-center gap-2">
                  <LeaseMoney
                    value={nextPaymentAmount}
                    currencyCode={currencyCode}
                  />
                  <DateTime value={nextDueDate} variant="date" />
                </span>
              ) : (
                <span>—</span>
              )}
            </HStack>
            {lease.status === "Draft" && (
              <p className="text-xs text-muted-foreground w-full">
                <Trans>
                  Purchase invoices are drafted automatically for each payment
                  once the lease is active.
                </Trans>
              </p>
            )}
          </VStack>
        </VStack>
      </CardContent>
    </Card>
  );
};

export default LeaseSummary;
