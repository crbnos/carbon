import {
  Badge,
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
import { useCurrencyDecimals, useCurrencyFormatter } from "~/hooks";
import { getPrivateUrl, path } from "~/utils/path";
import { LeaseClassificationBadge } from "./RentalLeaseClassification";
import RentalStatus from "./RentalStatus";
import type {
  RentalAgreement,
  RentalAgreementLine,
  RentalBillingPeriod,
  RentalLeaseLineInputs
} from "./types";
import { rentalUnitLabel } from "./useRentalLineActions";

type RentalAgreementSummaryProps = {
  rentalAgreement: RentalAgreement;
  lines: RentalAgreementLine[];
  periods: RentalBillingPeriod[];
  /** Draft only: the default ladder for a line with no rates of its own. */
  leaseInputs: Record<string, RentalLeaseLineInputs>;
};

type Ladder = {
  dayRate: number | null;
  weekRate: number | null;
  monthRate: number | null;
};

/** The agreement at a glance, laid out like the sales order summary: its
 *  units as line items with their rates, then what has been billed, what is
 *  still to bill, the deposit and the next due date. */
const RentalAgreementSummary = ({
  rentalAgreement,
  lines,
  periods,
  leaseInputs
}: RentalAgreementSummaryProps) => {
  const currencyCode = rentalAgreement.currencyCode ?? "USD";
  const currencyDecimals = useCurrencyDecimals(currencyCode);

  // A line's own rates; a Draft line without any bills the default ladder
  // (customer, customer type, else item) that activation will fix.
  const ladderOf = (line: RentalAgreementLine): Ladder =>
    line.dayRate !== null || line.weekRate !== null || line.monthRate !== null
      ? {
          dayRate: line.dayRate,
          weekRate: line.weekRate,
          monthRate: line.monthRate
        }
      : (leaseInputs[line.id]?.ladder ?? {
          dayRate: null,
          weekRate: null,
          monthRate: null
        });

  const billed = periods
    .filter((period) => period.status === "Invoiced")
    .reduce((sum, period) => sum + Number(period.amount ?? 0), 0);
  const monthlyRates = lines.map((line) => ladderOf(line).monthRate);
  const monthlyRent = monthlyRates.every((rate) => rate !== null)
    ? monthlyRates.reduce<number>((sum, rate) => sum + Number(rate), 0)
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
                billingCycle={rentalAgreement.billingCycle}
                currencyCode={currencyCode}
                line={line}
                ladder={ladderOf(line)}
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
        {rentalAgreement.status === "Draft" && lines.length > 0 && (
          <p className="mt-4 text-xs text-muted-foreground">
            <Trans>
              Rates are the items' current rental rates. They are fixed on each
              unit when the agreement is activated.
            </Trans>
          </p>
        )}
      </CardContent>
    </Card>
  );
};

function SummaryLine({
  agreementId,
  billingCycle,
  currencyCode,
  line,
  ladder
}: {
  agreementId: string;
  billingCycle: RentalAgreement["billingCycle"];
  currencyCode: string;
  line: RentalAgreementLine;
  ladder: Ladder;
}) {
  const { t } = useLingui();
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const rateFormatter = useCurrencyFormatter({
    currency: currencyCode,
    rate: true
  });

  // The headline is what the unit bills per cycle: the month rate on a
  // Calendar Month agreement or a best-rate 28-day unit, else its fixed tier.
  const headline =
    line.rateMode === "Fixed" && line.rateUnit === "Day"
      ? ladder.dayRate
      : line.rateMode === "Fixed" && line.rateUnit === "Week"
        ? ladder.weekRate
        : ladder.monthRate;
  const headlineUnit =
    line.rateMode === "Fixed" && line.rateUnit === "Day"
      ? t`per day`
      : line.rateMode === "Fixed" && line.rateUnit === "Week"
        ? t`per week`
        : billingCycle === "28 Days"
          ? t`per 28 days`
          : t`per month`;

  const tiers = [
    { label: t`Day`, value: ladder.dayRate },
    { label: t`Week`, value: ladder.weekRate },
    { label: t`Month`, value: ladder.monthRate }
  ].filter((tier) => tier.value !== null);

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
            {headline !== null ? (
              <VStack spacing={0} className="items-end">
                <MotionMoney
                  className="font-semibold text-xl whitespace-nowrap"
                  value={Number(headline)}
                  currency={currencyCode}
                  decimalPlaces={currencyDecimals}
                />
                <span className="text-xs text-muted-foreground">
                  {headlineUnit}
                </span>
              </VStack>
            ) : (
              <span className="text-sm text-muted-foreground">
                <Trans>No rental rates</Trans>
              </span>
            )}
            <div className="flex items-center gap-2">
              <Badge variant="outline">{line.rateMode}</Badge>
              {tiers.map((tier) => (
                <Badge key={tier.label} variant="green">
                  {rateFormatter.format(Number(tier.value))} / {tier.label}
                </Badge>
              ))}
            </div>
          </VStack>
        </div>
      </HStack>
    </div>
  );
}

export default RentalAgreementSummary;
