// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import { Trans, useLingui } from "@lingui/react/macro";
import { DateTime, Hyperlink } from "~/components";
import Money from "~/components/Money";
import { path } from "~/utils/path";
import LeaseInvoiceStatus from "./LeaseInvoiceStatus";
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
  // Most leases only pay rent; the Type column is for the odd purchase
  // option or termination penalty among them.
  const severalTypes =
    new Set(payments.map((payment) => payment.paymentType)).size > 1;
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
                <Th>
                  <Trans>Due</Trans>
                </Th>
                {severalAssets && (
                  <Th>
                    <Trans>Asset</Trans>
                  </Th>
                )}
                {severalTypes && (
                  <Th>
                    <Trans>Type</Trans>
                  </Th>
                )}
                <Th>
                  <Trans>Period</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Amount</Trans>
                </Th>
                <Th>
                  <Trans>Invoice</Trans>
                </Th>
                <Th>
                  <Trans>Status</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {payments.map((payment) => {
                const invoice = payment.purchaseInvoiceLineId
                  ? paymentInvoices[payment.purchaseInvoiceLineId]
                  : undefined;
                return (
                  <Tr key={payment.id}>
                    <Td className="whitespace-nowrap">
                      <DateTime value={payment.dueDate} variant="date" />
                    </Td>
                    {severalAssets && (
                      <Td className="whitespace-nowrap">
                        {assetName.get(payment.leaseLineId) ?? "—"}
                      </Td>
                    )}
                    {severalTypes && (
                      <Td className="whitespace-nowrap">
                        {paymentTypeLabel(payment.paymentType)}
                      </Td>
                    )}
                    <Td className="whitespace-nowrap text-muted-foreground">
                      <DateTime value={payment.periodStart} variant="date" />
                      {" – "}
                      <DateTime value={payment.periodEnd} variant="date" />
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <Money
                        value={payment.amount}
                        currencyCode={currencyCode}
                      />
                    </Td>
                    <Td className="whitespace-nowrap">
                      {invoice ? (
                        <Hyperlink
                          to={path.to.purchaseInvoiceDetails(invoice.id)}
                        >
                          {invoice.invoiceId ?? t`Invoice`}
                        </Hyperlink>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td>
                      {/* Once invoiced, the invoice's own status says more
                          than "Invoiced": Draft, Submitted, Paid. */}
                      {invoice?.status ? (
                        <LeaseInvoiceStatus status={invoice.status} />
                      ) : (
                        <LeasePaymentStatus status={payment.status} />
                      )}
                    </Td>
                  </Tr>
                );
              })}
              <Tr>
                <Td className="font-medium">
                  <Trans>Total</Trans>
                </Td>
                {severalAssets && <Td />}
                {severalTypes && <Td />}
                <Td />
                <Td className="text-right font-medium whitespace-nowrap">
                  <Money value={total} currencyCode={currencyCode} />
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
