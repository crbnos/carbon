import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Hyperlink } from "~/components";
import { useDateFormatter } from "~/hooks";
import { path } from "~/utils/path";
import RentalMoney from "./RentalMoney";
import RentalStatus from "./RentalStatus";
import type {
  RentalAgreement,
  RentalBillingPeriod,
  RentalInvoiceLinks
} from "./types";

type RentalBillingPeriodsProps = {
  rentalAgreement: RentalAgreement;
  periods: RentalBillingPeriod[];
  invoiceLinks: RentalInvoiceLinks;
};

const RentalBillingPeriods = ({
  rentalAgreement,
  periods,
  invoiceLinks
}: RentalBillingPeriodsProps) => {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();

  const tierLabel = (unit: RentalBillingPeriod["rateUnitApplied"]) => {
    switch (unit) {
      case "Day":
        return t`Day`;
      case "Week":
        return t`Week`;
      case "Month":
        return t`Month`;
      default:
        return "—";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Billing Periods</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {periods.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {rentalAgreement.status === "Draft" ? (
              <Trans>
                Billing periods are cut when the agreement is activated.
              </Trans>
            ) : (
              <Trans>No billing periods.</Trans>
            )}
          </p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Unit</Trans>
                </Th>
                <Th>
                  <Trans>Period</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Days</Trans>
                </Th>
                <Th>
                  <Trans>Tier</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Amount</Trans>
                </Th>
                <Th>
                  <Trans>Due</Trans>
                </Th>
                <Th>
                  <Trans>Status</Trans>
                </Th>
                <Th>
                  <Trans>Invoice</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {periods.map((period) => {
                const invoice = period.salesInvoiceLineId
                  ? invoiceLinks[period.salesInvoiceLineId]
                  : undefined;
                return (
                  <Tr key={period.id}>
                    <Td>
                      {period.rentalAgreementLine?.fixedAsset?.fixedAssetId ??
                        "—"}
                    </Td>
                    <Td>
                      <span className="whitespace-nowrap">
                        {formatDate(period.periodStart)} –{" "}
                        {formatDate(period.periodEnd)}
                      </span>
                      {period.isAdjustment && (
                        <Badge variant="orange" className="ml-2">
                          <Trans>Adjustment</Trans>
                        </Badge>
                      )}
                    </Td>
                    <Td className="text-right tabular-nums">{period.days}</Td>
                    <Td>{tierLabel(period.rateUnitApplied)}</Td>
                    <Td className="text-right">
                      <RentalMoney
                        value={period.amount}
                        currencyCode={rentalAgreement.currencyCode}
                      />
                    </Td>
                    <Td>{formatDate(period.dueOn)}</Td>
                    <Td>
                      <RentalStatus status={period.status} />
                    </Td>
                    <Td>
                      {invoice ? (
                        <Hyperlink to={path.to.salesInvoiceDetails(invoice.id)}>
                          {invoice.invoiceId ?? t`Invoice`}
                        </Hyperlink>
                      ) : (
                        "—"
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default RentalBillingPeriods;
