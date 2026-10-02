// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuImage } from "react-icons/lu";
import { Link } from "react-router";
import { CustomerAvatar, DateTime, MotionMoney } from "~/components";
import { useCurrencyDecimals } from "~/hooks";
import { getPrivateUrl, path } from "~/utils/path";
import { LeaseClassificationBadge } from "./RentalLeaseClassification";
import RentalStatus from "./RentalStatus";
import type {
  RentalAgreement,
  RentalAgreementLine,
  RentalBillingPeriod
} from "./types";
import { rentalUnitLabel } from "./useRentalLineActions";

type RentalAgreementSummaryProps = {
  rentalAgreement: RentalAgreement;
  lines: RentalAgreementLine[];
  periods: RentalBillingPeriod[];
};

/** The agreement at a glance, laid out like the sales order summary: its
 *  units as line items with their rates, then what has been billed, what is
 *  still to bill, the deposit and the next due date. */
const RentalAgreementSummary = ({
  rentalAgreement,
  lines,
  periods
}: RentalAgreementSummaryProps) => {
  const currencyCode = rentalAgreement.currencyCode ?? "USD";
  const currencyDecimals = useCurrencyDecimals(currencyCode);

  const billed = periods
    .filter((period) => period.status === "Invoiced")
    .reduce((sum, period) => sum + Number(period.amount ?? 0), 0);
  // Only a sum of like rates means anything: shown when every unit is Monthly.
  const monthlyRent =
    lines.length > 0 && lines.every((line) => line.rateUnit === "Month")
      ? lines.reduce((sum, line) => sum + Number(line.rate), 0)
      : null;

  return (
    <Card>
      <CardHeader>
        <HStack className="justify-between items-center">
          <div className="flex flex-col gap-1">
            <CardTitle>{rentalAgreement.rentalAgreementId}</CardTitle>
          </div>
          <div className="flex flex-col gap-1 items-end">
            <CustomerAvatar customerId={rentalAgreement.customerId ?? null} />
            <span className="text-xs text-muted-foreground tracking-tight">
              <DateTime value={rentalAgreement.startDate} variant="date" />
              {" – "}
              {rentalAgreement.endDate ? (
                <DateTime value={rentalAgreement.endDate} variant="date" />
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
              No units yet. Add a fleet unit from the Units list before
              activating the agreement.
            </Trans>
          </p>
        ) : (
          <VStack spacing={0} className="w-full overflow-hidden">
            {lines.map((line) => (
              <SummaryLine
                key={line.id}
                agreementId={rentalAgreement.id!}
                currencyCode={currencyCode}
                line={line}
              />
            ))}
          </VStack>
        )}

        <VStack spacing={2} className="mt-8">
          <HStack className="justify-between text-sm text-muted-foreground w-full">
            <span>
              <Trans>Billed:</Trans>
            </span>
            <MotionMoney
              value={billed}
              currency={currencyCode}
              decimalPlaces={currencyDecimals}
            />
          </HStack>
          <HStack className="justify-between text-sm text-muted-foreground w-full">
            <span>
              <Trans>Unbilled:</Trans>
            </span>
            <MotionMoney
              value={Number(rentalAgreement.unbilledAmount ?? 0)}
              currency={currencyCode}
              decimalPlaces={currencyDecimals}
            />
          </HStack>
          {monthlyRent !== null && (
            <HStack className="justify-between text-xl font-semibold w-full">
              <span>
                <Trans>Monthly Rent:</Trans>
              </span>
              <MotionMoney
                value={monthlyRent}
                currency={currencyCode}
                decimalPlaces={currencyDecimals}
              />
            </HStack>
          )}
          <div className="h-px bg-border my-2 w-full" />
          <HStack className="justify-between text-sm text-muted-foreground w-full">
            <span>
              <Trans>Deposit:</Trans>
            </span>
            <MotionMoney
              value={Number(rentalAgreement.depositAmount ?? 0)}
              currency={currencyCode}
              decimalPlaces={currencyDecimals}
            />
          </HStack>
          <HStack className="justify-between text-sm text-muted-foreground w-full">
            <span>
              <Trans>Next Due:</Trans>
            </span>
            <span>
              {rentalAgreement.nextDueOn ? (
                <DateTime value={rentalAgreement.nextDueOn} variant="date" />
              ) : (
                "—"
              )}
            </span>
          </HStack>
        </VStack>
      </CardContent>
    </Card>
  );
};

function SummaryLine({
  agreementId,
  currencyCode,
  line
}: {
  agreementId: string;
  currencyCode: string;
  line: RentalAgreementLine;
}) {
  const { t } = useLingui();
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const per =
    line.rateUnit === "Day"
      ? t`per day`
      : line.rateUnit === "Week"
        ? t`per week`
        : t`per month`;

  return (
    <div className="border-b border-input py-6 w-full">
      <HStack spacing={4} className="items-start">
        {line.item?.thumbnailPath ? (
          <img
            alt={line.item?.readableIdWithRevision ?? ""}
            className="w-24 h-24 shrink-0 bg-gradient-to-bl from-muted to-muted/40 rounded-lg"
            src={getPrivateUrl(line.item.thumbnailPath)}
          />
        ) : (
          <div className="w-24 h-24 shrink-0 bg-gradient-to-bl from-muted to-muted/40 rounded-lg p-4">
            <LuImage className="w-16 h-16 text-muted-foreground" />
          </div>
        )}
        <div className="flex items-start justify-between flex-1 min-w-0 gap-4">
          <VStack spacing={0} className="flex-1 min-w-0">
            <HStack spacing={2} className="flex min-w-0 w-full">
              <Heading className="truncate">
                {line.fixedAsset?.fixedAssetId ?? rentalUnitLabel(line)}
              </Heading>
              <Button
                asChild
                variant="link"
                size="sm"
                className="text-muted-foreground flex-shrink-0"
              >
                <Link to={path.to.rentalAgreementLine(agreementId, line.id)}>
                  <Trans>View</Trans>
                </Link>
              </Button>
            </HStack>
            <span className="text-muted-foreground text-sm truncate w-full">
              {[
                line.item?.readableIdWithRevision,
                line.fixedAsset?.serialNumber
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <HStack spacing={2} className="mt-2">
              <RentalStatus status={line.status} />
              {line.lessorClassification && (
                <LeaseClassificationBadge value={line.lessorClassification} />
              )}
            </HStack>
          </VStack>
          <VStack spacing={2} className="flex-shrink-0 items-end w-auto">
            <VStack spacing={0} className="items-end">
              <MotionMoney
                className="font-semibold text-xl whitespace-nowrap"
                value={Number(line.rate)}
                currency={currencyCode}
                decimalPlaces={currencyDecimals}
              />
              <span className="text-xs text-muted-foreground">{per}</span>
            </VStack>
          </VStack>
        </div>
      </HStack>
    </div>
  );
}

export default RentalAgreementSummary;
