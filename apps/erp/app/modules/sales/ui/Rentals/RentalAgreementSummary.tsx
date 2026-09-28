import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useDateFormatter } from "~/hooks";
import { path } from "~/utils/path";
import RentalMoney from "./RentalMoney";
import type { RentalAgreement } from "./types";

type RentalAgreementSummaryProps = {
  rentalAgreement: RentalAgreement;
};

/** What the agreement holds and what it is owed, laid out like the fixed
 *  asset card: a stat row over label / value rows. */
const RentalAgreementSummary = ({
  rentalAgreement
}: RentalAgreementSummaryProps) => {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Summary</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0">
        <div className="grid grid-cols-1 gap-3 pb-4 sm:grid-cols-3 sm:gap-0">
          <Stat label={t`Deposit`} className="sm:pr-6">
            <RentalMoney
              value={rentalAgreement.depositAmount}
              currencyCode={rentalAgreement.currencyCode}
            />
          </Stat>
          <Stat
            label={t`Unbilled`}
            className="sm:border-l sm:border-border sm:px-6"
          >
            <RentalMoney
              value={rentalAgreement.unbilledAmount}
              currencyCode={rentalAgreement.currencyCode}
            />
          </Stat>
          <Stat
            label={t`Next Due`}
            className="sm:border-l sm:border-border sm:pl-6"
          >
            {rentalAgreement.nextDueOn
              ? formatDate(rentalAgreement.nextDueOn)
              : "—"}
          </Stat>
        </div>
        <div className="divide-y divide-border border-t border-border">
          <DetailRow label={t`Customer`}>
            {rentalAgreement.customerId ? (
              <Link
                to={path.to.customer(rentalAgreement.customerId)}
                className="hover:underline"
              >
                {rentalAgreement.customerName}
              </Link>
            ) : (
              "—"
            )}
          </DetailRow>
          <DetailRow label={t`Term`}>
            {formatDate(rentalAgreement.startDate)} –{" "}
            {rentalAgreement.endDate ? (
              formatDate(rentalAgreement.endDate)
            ) : (
              <Trans>Open-ended</Trans>
            )}
          </DetailRow>
          <DetailRow label={t`Billing Cycle`}>
            {rentalAgreement.billingCycle}
          </DetailRow>
          <DetailRow label={t`Billing Timing`}>
            {rentalAgreement.billingTiming}
          </DetailRow>
        </div>
      </CardContent>
    </Card>
  );
};

function Stat({
  label,
  className,
  children
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <p className="text-base text-muted-foreground truncate sm:text-sm">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
        {children}
      </p>
    </div>
  );
}

function DetailRow({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3 text-base sm:text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}

export default RentalAgreementSummary;
