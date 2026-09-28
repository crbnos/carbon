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
import { round, SCALE_FORMAT } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import { DateTime, Hyperlink } from "~/components";
import { useCurrencyFormatter } from "~/hooks";
import type { getInvoiceSettlements } from "~/modules/invoicing";
import { path } from "~/utils/path";

type PaymentApplication = NonNullable<
  Awaited<ReturnType<typeof getInvoiceSettlements>>["data"]
>[number];

type PaymentApplicationsProps = {
  isRefund?: boolean;
  applications: PaymentApplication[];
  paymentTotal: number;
  paymentCurrency: string;
  baseCurrency: string;
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
    targetMemoId?: string | null;
    targetMemo?:
      | { memoId?: string | null }
      | { memoId?: string | null }[]
      | null;
  };
  const pick = (x: typeof rec.salesInvoice) =>
    Array.isArray(x) ? x[0]?.invoiceId : x?.invoiceId;
  return (
    pick(rec.salesInvoice) ??
    pick(rec.purchaseInvoice) ??
    (Array.isArray(rec.targetMemo)
      ? rec.targetMemo[0]?.memoId
      : rec.targetMemo?.memoId) ??
    rec.targetSalesInvoiceId ??
    rec.targetPurchaseInvoiceId ??
    rec.targetMemoId
  );
}

const PaymentApplications = ({
  isRefund = false,
  applications: splits,
  paymentCurrency,
  baseCurrency,
  paymentTotal
}: PaymentApplicationsProps) => {
  const currencyFormatter = useCurrencyFormatter({ currency: baseCurrency });
  const documentFormatter = useCurrencyFormatter({ currency: paymentCurrency });
  const byInvoice = new Map<
    string,
    PaymentApplication & { sourceRates: number[] }
  >();
  for (const a of splits) {
    const id =
      a.targetSalesInvoiceId ??
      a.targetPurchaseInvoiceId ??
      a.targetMemoId ??
      a.id;
    const existing = byInvoice.get(id);
    if (!existing) {
      byInvoice.set(id, { ...a, sourceRates: [Number(a.sourceExchangeRate)] });
      continue;
    }
    existing.appliedAmount = round(
      existing.appliedAmount + Number(a.appliedAmount)
    );
    existing.discountAmount = round(
      existing.discountAmount + Number(a.discountAmount)
    );
    existing.writeOffAmount = round(
      existing.writeOffAmount + Number(a.writeOffAmount)
    );
    existing.sourceAmount =
      (existing.sourceAmount ?? 0) + Number(a.sourceAmount ?? 0);
    existing.fxGainLossAmount = round(
      Number(existing.fxGainLossAmount ?? 0) + Number(a.fxGainLossAmount ?? 0)
    );
    existing.sourceRates = [
      ...new Set([...existing.sourceRates, Number(a.sourceExchangeRate)])
    ];
  }
  const applications = [...byInvoice.values()];
  const rateFormatter = useNumberFormatter(SCALE_FORMAT);

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
    splits.reduce(
      (s, a) => s + (a.sourcePaymentId ? 0 : Number(a.sourceAmount ?? 0)),
      0
    );

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
              <Th>{isRefund ? <Trans>Memo</Trans> : <Trans>Invoice</Trans>}</Th>
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
                    ) : a.targetMemoId ? (
                      <Hyperlink to={path.to.memo(a.targetMemoId)}>
                        {invoiceLabel(a)}
                      </Hyperlink>
                    ) : (
                      invoiceLabel(a)
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {currencyFormatter.format(Number(a.appliedAmount))}
                    <div className="text-xs text-muted-foreground">
                      {documentFormatter.format(Number(a.sourceAmount ?? 0))}
                    </div>
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
                    {a.sourceRates
                      .map((rate) => rateFormatter.format(rate))
                      .join(" / ")}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {currencyFormatter.format(Number(a.fxGainLossAmount ?? 0))}
                  </Td>
                  <Td>
                    <DateTime value={a.appliedDate} variant="date" />
                  </Td>
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
                  {documentFormatter.format(unapplied)}
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
