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
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { DateTime, Hyperlink } from "~/components";
import { PurchaseInvoicingStatus } from "~/modules/invoicing/ui/PurchaseInvoice";
import { path } from "~/utils/path";
import LeaseMoney from "./LeaseMoney";
import { LeasePaymentStatus } from "./LeaseStatus";
import type {
  Lease,
  LeaseLine,
  LeasePayment,
  LeasePaymentInvoiceLinks
} from "./types";
import { useLeasePaymentTypeLabel } from "./useLeaseLabels";

type LeasePaymentsProps = {
  lease: Lease;
  lines: LeaseLine[];
  payments: LeasePayment[];
  paymentInvoices: LeasePaymentInvoiceLinks;
};

/** Every asset's payment rows: what the lease pays and when, each row with
 *  its status and the purchase invoice that billed it. A Draft's rows are
 *  edited in its setup (Payments step). */
const LeasePayments = ({
  lease,
  lines,
  payments,
  paymentInvoices
}: LeasePaymentsProps) => {
  const { t } = useLingui();
  const paymentTypeLabel = useLeasePaymentTypeLabel();
  const currencyCode = lease.currencyCode ?? "";

  const assetName = new Map(lines.map((line) => [line.id, line.description]));
  const severalAssets = lines.length > 1;
  const total = payments.reduce(
    (sum, payment) => sum + Number(payment.amount),
    0
  );

  return (
    <Card id="payments">
      <CardHeader>
        <CardTitle>
          <Trans>Payments</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            A purchase invoice is drafted for each due date, with a line for
            each asset's payment.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No payment rows.</Trans>
          </p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th className="text-right">#</Th>
                {severalAssets && (
                  <Th>
                    <Trans>Asset</Trans>
                  </Th>
                )}
                <Th>
                  <Trans>Type</Trans>
                </Th>
                <Th>
                  <Trans>Period</Trans>
                </Th>
                <Th>
                  <Trans>Due</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Amount</Trans>
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
              {payments.map((payment, index) => {
                const invoice = payment.purchaseInvoiceLineId
                  ? paymentInvoices[payment.purchaseInvoiceLineId]
                  : undefined;
                return (
                  <Tr key={payment.id}>
                    <Td className="text-right tabular-nums text-muted-foreground">
                      {index + 1}
                    </Td>
                    {severalAssets && (
                      <Td>{assetName.get(payment.leaseLineId) ?? "—"}</Td>
                    )}
                    <Td>{paymentTypeLabel(payment.paymentType)}</Td>
                    <Td>
                      <span className="whitespace-nowrap">
                        <DateTime value={payment.periodStart} variant="date" />
                        {" – "}
                        <DateTime value={payment.periodEnd} variant="date" />
                      </span>
                    </Td>
                    <Td>
                      <DateTime value={payment.dueDate} variant="date" />
                    </Td>
                    <Td className="text-right">
                      <LeaseMoney
                        value={payment.amount}
                        currencyCode={currencyCode}
                      />
                    </Td>
                    <Td>
                      <LeasePaymentStatus status={payment.status} />
                    </Td>
                    <Td>
                      {invoice ? (
                        <HStack spacing={2}>
                          <Hyperlink
                            to={path.to.purchaseInvoiceDetails(invoice.id)}
                          >
                            {invoice.invoiceId ?? t`Invoice`}
                          </Hyperlink>
                          <PurchaseInvoicingStatus
                            status={
                              invoice.status as Parameters<
                                typeof PurchaseInvoicingStatus
                              >[0]["status"]
                            }
                          />
                        </HStack>
                      ) : (
                        "—"
                      )}
                    </Td>
                  </Tr>
                );
              })}
              <Tr>
                <Td />
                {severalAssets && <Td />}
                <Td className="font-medium">
                  <Trans>Total</Trans>
                </Td>
                <Td />
                <Td />
                <Td className="text-right font-medium">
                  <LeaseMoney value={total} currencyCode={currencyCode} />
                </Td>
                <Td />
                <Td />
              </Tr>
            </Tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default LeasePayments;
