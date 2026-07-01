import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  Tbody,
  Td,
  Tfoot,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import { Hyperlink } from "~/components";
import { useCurrencyFormatter, useDateFormatter } from "~/hooks";
import type { getInvoiceSettlements } from "~/modules/invoicing";
import { path } from "~/utils/path";

type PaymentApplication = NonNullable<
  Awaited<ReturnType<typeof getInvoiceSettlements>>["data"]
>[number];

type PaymentApplicationsProps = {
  applications: PaymentApplication[];
  paymentTotal: number;
};

// The applied invoice's human-readable id comes from the embedded
// salesInvoice/purchaseInvoice relation (getInvoiceSettlements); fall back to
// the raw FK id if the relation didn't resolve.
function invoiceLabel(a: PaymentApplication) {
  const rec = a as unknown as {
    salesInvoice?:
      | { invoiceId?: string | null }
      | { invoiceId?: string | null }[]
      | null;
    purchaseInvoice?:
      | { invoiceId?: string | null }
      | { invoiceId?: string | null }[]
      | null;
    targetSalesInvoiceId?: string | null;
    targetPurchaseInvoiceId?: string | null;
  };
  const pick = (x: typeof rec.salesInvoice) =>
    Array.isArray(x) ? x[0]?.invoiceId : x?.invoiceId;
  return (
    pick(rec.salesInvoice) ??
    pick(rec.purchaseInvoice) ??
    rec.targetSalesInvoiceId ??
    rec.targetPurchaseInvoiceId
  );
}

const PaymentApplications = ({
  applications,
  paymentTotal
}: PaymentApplicationsProps) => {
  const { formatDate } = useDateFormatter();
  const currencyFormatter = useCurrencyFormatter();
  const rateFormatter = useNumberFormatter({
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  });

  const totalApplied = applications.reduce(
    (sum, a) =>
      sum +
      Number(a.appliedAmount) +
      Number(a.discountAmount) +
      Number(a.writeOffAmount),
    0
  );
  const unapplied =
    paymentTotal -
    applications.reduce((s, a) => s + Number(a.appliedAmount), 0);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Payment Applications</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <Thead>
            <Tr>
              <Th>
                <Trans>Invoice</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Applied</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Discount</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Write-Off</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Inv Rate</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Pay Rate</Trans>
              </Th>
              <Th className="text-right">
                <Trans>FX G/L</Trans>
              </Th>
              <Th>
                <Trans>Applied Date</Trans>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {applications.length === 0 ? (
              <Tr>
                <Td colSpan={8} className="text-center text-muted-foreground">
                  <Trans>No applications. Payment will be on-account.</Trans>
                </Td>
              </Tr>
            ) : (
              applications.map((a) => (
                <Tr key={a.id}>
                  <Td>
                    {a.targetSalesInvoiceId ? (
                      <Hyperlink
                        to={path.to.salesInvoice(a.targetSalesInvoiceId)}
                      >
                        {invoiceLabel(a)}
                      </Hyperlink>
                    ) : a.targetPurchaseInvoiceId ? (
                      <Hyperlink
                        to={path.to.purchaseInvoice(a.targetPurchaseInvoiceId)}
                      >
                        {invoiceLabel(a)}
                      </Hyperlink>
                    ) : (
                      invoiceLabel(a)
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {currencyFormatter.format(Number(a.appliedAmount))}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {currencyFormatter.format(Number(a.discountAmount))}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {currencyFormatter.format(Number(a.writeOffAmount))}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {rateFormatter.format(Number(a.targetExchangeRate))}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {rateFormatter.format(Number(a.sourceExchangeRate))}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {currencyFormatter.format(Number(a.fxGainLossAmount ?? 0))}
                  </Td>
                  <Td>{formatDate(a.appliedDate)}</Td>
                </Tr>
              ))
            )}
          </Tbody>
          {applications.length > 0 && (
            <Tfoot>
              <Tr>
                <Td className="text-right font-semibold">
                  <Trans>Totals</Trans>
                </Td>
                <Td className="text-right tabular-nums font-semibold">
                  {currencyFormatter.format(totalApplied)}
                </Td>
                <Td colSpan={5} />
                <Td className="text-right tabular-nums">
                  <Trans>Unapplied:</Trans>{" "}
                  {currencyFormatter.format(unapplied)}
                </Td>
              </Tr>
            </Tfoot>
          )}
        </Table>
      </CardContent>
    </Card>
  );
};

export default PaymentApplications;
