import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { Link } from "react-router";
import { Empty } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useCurrencyFormatter, useDateFormatter } from "~/hooks";
import type { InvoiceSettlementForInvoice } from "~/modules/invoicing";
import { path } from "~/utils/path";

type InvoiceSettlementsPanelProps = {
  rows: InvoiceSettlementForInvoice[];
};

// Everything applied to the invoice — cash payments AND credit/debit memos —
// in one list. (Export name kept as InvoicePaymentsPanel for its callers.)
const InvoicePaymentsPanel = ({ rows }: InvoiceSettlementsPanelProps) => {
  const { formatDate } = useDateFormatter();
  // FX gain/loss is recorded in base currency.
  const currencyFormatter = useCurrencyFormatter();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Payments</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Payments and credits applied to this invoice. Click a row to open
            the source document.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <Empty />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Date</Trans>
                </Th>
                <Th>
                  <Trans>Type</Trans>
                </Th>
                <Th>
                  <Trans>Source</Trans>
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
                  <Trans>FX G/L</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>{formatDate(r.appliedDate)}</Td>
                  <Td>
                    <Enumerable
                      value={
                        r.source.type === "payment"
                          ? "Cash"
                          : r.source.direction
                      }
                    />
                  </Td>
                  <Td>
                    <Link
                      to={
                        r.source.type === "payment"
                          ? path.to.payment(r.source.id)
                          : path.to.memo(r.source.id)
                      }
                      className="text-primary hover:underline"
                    >
                      {r.source.readableId}
                    </Link>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {currencyFormatter.format(Number(r.appliedAmount))}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {currencyFormatter.format(Number(r.discountAmount))}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {currencyFormatter.format(Number(r.writeOffAmount))}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {currencyFormatter.format(Number(r.fxGainLossAmount ?? 0))}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default InvoicePaymentsPanel;
