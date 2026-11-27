// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Table as TableBase, Tbody, Td, Th, Thead, Tr } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { Link } from "react-router";
import { DateTime } from "~/components";
import { IndeterminateCheckbox } from "~/components/Table/components";
import { daysPastDue } from "~/modules/invoicing/invoicing.reports";
import { path } from "~/utils/path";
import type { OpenInvoiceRow, OpenPaymentRow } from "./types";

type CounterpartyDocumentsProps = {
  side: "ar" | "ap";
  asOfDate: string;
  documents: OpenInvoiceRow[];
  payments: OpenPaymentRow[];
  selectedIds: Set<string>;
  money: (n: number) => string;
  onSelectDocument: (
    documents: OpenInvoiceRow[],
    invoiceId: string,
    checked: boolean,
    shiftKey: boolean
  ) => void;
};

// One counterparty's open documents and payments, shown when its report row is expanded.
export function CounterpartyDocuments({
  side,
  asOfDate,
  documents,
  payments,
  selectedIds,
  money,
  onSelectDocument
}: CounterpartyDocumentsProps) {
  const { t } = useLingui();
  return (
    <div className="p-3">
      <TableBase className="min-w-[900px]">
        <Thead>
          <Tr>
            <Th className="w-10 px-2" />
            <Th>{t`Document`}</Th>
            <Th>{t`Transaction Date`}</Th>
            <Th>{t`Type`}</Th>
            {side === "ap" ? <Th>{t`Supplier Invoice Number`}</Th> : null}
            <Th>{t`Due Date`}</Th>
            <Th>{t`Original Amount`}</Th>
            <Th>{t`Days Past Due`}</Th>
            <Th>{t`Open Amount`}</Th>
          </Tr>
        </Thead>
        <Tbody>
          {documents.map((document) => {
            const documentHref =
              document.documentType === "Invoice"
                ? side === "ar"
                  ? path.to.salesInvoiceDetails(document.invoiceId)
                  : path.to.purchaseInvoiceDetails(document.invoiceId)
                : path.to.memo(document.invoiceId);
            const documentType =
              document.documentType === "Invoice"
                ? t`Invoice`
                : document.documentType === "Credit Memo"
                  ? t`Credit Memo`
                  : document.documentType === "Debit Memo"
                    ? t`Debit Memo`
                    : document.documentType;
            return (
              <Tr key={document.invoiceId}>
                <Td className="px-2">
                  <IndeterminateCheckbox
                    checked={selectedIds.has(document.invoiceId)}
                    indeterminate={false}
                    onChange={(checked, shiftKey) =>
                      onSelectDocument(
                        documents,
                        document.invoiceId,
                        checked,
                        shiftKey
                      )
                    }
                  />
                </Td>
                <Td>
                  <Link to={documentHref} className="hover:underline">
                    {document.invoiceNumber}
                  </Link>
                </Td>
                <Td>
                  {document.transactionDate ? (
                    <DateTime value={document.transactionDate} variant="date" />
                  ) : (
                    "—"
                  )}
                </Td>
                <Td>{documentType}</Td>
                {side === "ap" ? (
                  <Td>{document.supplierReference ?? "—"}</Td>
                ) : null}
                <Td>
                  {document.dateDue ? (
                    <DateTime value={document.dateDue} variant="date" />
                  ) : (
                    "—"
                  )}
                </Td>
                <Td className="tabular-nums">
                  {money(document.originalInBase)}
                </Td>
                <Td className="tabular-nums">
                  {daysPastDue(asOfDate, document.dateDue) ?? "—"}
                </Td>
                <Td className="tabular-nums">{money(document.openInBase)}</Td>
              </Tr>
            );
          })}
          {payments.map((payment) => (
            <Tr key={payment.paymentId}>
              <Td />
              <Td>
                <Link
                  to={path.to.payment(payment.paymentId)}
                  className="hover:underline"
                >
                  {payment.paymentNumber}
                </Link>
              </Td>
              <Td>
                {payment.transactionDate ? (
                  <DateTime value={payment.transactionDate} variant="date" />
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                {payment.paymentType === "Receipt"
                  ? t`Receipt`
                  : t`Disbursement`}
              </Td>
              {side === "ap" ? <Td>—</Td> : null}
              <Td>—</Td>
              <Td className="tabular-nums">{money(payment.originalInBase)}</Td>
              <Td>—</Td>
              <Td className="tabular-nums">{money(payment.openInBase)}</Td>
            </Tr>
          ))}
        </Tbody>
      </TableBase>
    </div>
  );
}
