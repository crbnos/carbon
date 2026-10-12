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
import Money from "~/components/Money";
import { LesseeClassificationBadge } from "./LesseeClassificationBadge";
import type {
  Lease,
  LeaseLine,
  LeasePayment,
  LeaseScheduleLine
} from "./types";
import { useLeaseFrequencyLabel } from "./useLeaseLabels";
import { leaseAssetBalances } from "./utils";

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

/** The lease at a glance: its terms, its treatment, its active assets'
 *  liability and net right-of-use asset as of the last posted lease run, and
 *  the next payment. The asset count and the payment are the `leases`
 *  view's, over the active assets (all of them once the lease has ended). */
const LeaseSummary = ({
  lease,
  lines,
  payments,
  schedule
}: LeaseSummaryProps) => {
  const { t } = useLingui();
  const { locale } = useLocale();
  const currencyCode = lease.currencyCode;

  const frequencyLabel = useLeaseFrequencyLabel();

  // Each active, capitalized asset's balances after its last posted month —
  // the same liability the asset page and the leases list show.
  let liability = 0;
  let netRou = 0;
  let initialLiability = 0;
  let lastPosted: string | null = null;
  let recognized = 0;
  for (const line of lines) {
    const balances = leaseAssetBalances(line, schedule);
    if (!balances) continue;
    recognized += 1;
    initialLiability += Number(line.initialLiability ?? 0);
    liability += balances.liability;
    netRou += balances.netRouAsset;
    if (
      balances.postedThrough &&
      (!lastPosted || balances.postedThrough > lastPosted)
    ) {
      lastPosted = balances.postedThrough;
    }
  }
  liability = round(liability);
  netRou = round(netRou);
  initialLiability = round(initialLiability);
  const hasBalances = lease.status === "Active" && recognized > 0;

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
  const frequency = frequencyLabel(lease.paymentFrequency, "per");
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
                <span className="tabular-nums">
                  {lease.assetCount ?? lines.length}
                </span>
              </Fact>
              <Fact label={<Trans>Payment</Trans>}>
                <Money
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
                  <Money value={initialLiability} currencyCode={currencyCode} />
                </HStack>
                <HStack className="justify-between text-sm text-muted-foreground w-full">
                  <span>
                    <Trans>Net Right-of-Use Asset:</Trans>
                  </span>
                  <Money value={netRou} currencyCode={currencyCode} />
                </HStack>
                <HStack className="justify-between text-xl font-semibold w-full">
                  <span>
                    <Trans>Lease Liability:</Trans>
                  </span>
                  <Money value={liability} currencyCode={currencyCode} />
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
                  <Money
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
