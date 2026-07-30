import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router";
import type { PeriodCloseUnpostedDocument } from "~/modules/accounting";
import { JournalEntryStatus } from "~/modules/accounting/ui/JournalEntries";
import { ReceiptStatus } from "~/modules/inventory/ui/Receipts";
import { ShipmentStatus } from "~/modules/inventory/ui/Shipments";
import { MemoStatus } from "~/modules/invoicing/ui/Memo";
import { PaymentStatus } from "~/modules/invoicing/ui/Payment";
import { PurchaseInvoicingStatus } from "~/modules/invoicing/ui/PurchaseInvoice";
import SalesInvoiceStatus from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceStatus";
import { path } from "~/utils/path";

type Props = {
  documents: PeriodCloseUnpostedDocument[];
  count: number;
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
};

function documentPath(doc: PeriodCloseUnpostedDocument) {
  switch (doc.documentType) {
    case "Receipt":
      return path.to.receipt(doc.id);
    case "Shipment":
      return path.to.shipment(doc.id);
    case "Sales Invoice":
      return path.to.salesInvoice(doc.id);
    case "Purchase Invoice":
      return path.to.purchaseInvoice(doc.id);
    case "Payment":
      return path.to.payment(doc.id);
    case "Credit Memo":
    case "Debit Memo":
      return path.to.memo(doc.id);
    case "Journal Entry":
      return path.to.journalEntry(doc.id);
  }
}

function DocumentTypeLabel({
  documentType
}: {
  documentType: PeriodCloseUnpostedDocument["documentType"];
}) {
  switch (documentType) {
    case "Receipt":
      return <Trans>Receipt</Trans>;
    case "Shipment":
      return <Trans>Shipment</Trans>;
    case "Sales Invoice":
      return <Trans>Sales Invoice</Trans>;
    case "Purchase Invoice":
      return <Trans>Purchase Invoice</Trans>;
    case "Payment":
      return <Trans>Payment</Trans>;
    case "Credit Memo":
      return <Trans>Credit Memo</Trans>;
    case "Debit Memo":
      return <Trans>Debit Memo</Trans>;
    case "Journal Entry":
      return <Trans>Journal Entry</Trans>;
  }
}

function DocumentStatus({ doc }: { doc: PeriodCloseUnpostedDocument }) {
  switch (doc.documentType) {
    case "Receipt":
      return (
        <ReceiptStatus
          status={doc.status as ComponentProps<typeof ReceiptStatus>["status"]}
        />
      );
    case "Shipment":
      return (
        <ShipmentStatus
          status={doc.status as ComponentProps<typeof ShipmentStatus>["status"]}
        />
      );
    case "Sales Invoice":
      return <SalesInvoiceStatus status={doc.status} />;
    case "Purchase Invoice":
      return (
        <PurchaseInvoicingStatus
          status={
            doc.status as ComponentProps<
              typeof PurchaseInvoicingStatus
            >["status"]
          }
        />
      );
    case "Payment":
      return (
        <PaymentStatus
          status={doc.status as ComponentProps<typeof PaymentStatus>["status"]}
        />
      );
    case "Credit Memo":
    case "Debit Memo":
      return (
        <MemoStatus
          status={doc.status as ComponentProps<typeof MemoStatus>["status"]}
        />
      );
    case "Journal Entry":
      return (
        <JournalEntryStatus
          status={
            doc.status as ComponentProps<typeof JournalEntryStatus>["status"]
          }
        />
      );
  }
}

export function PeriodCloseUnpostedDocumentsPopover({
  documents,
  count,
  title,
  description,
  children
}: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-xl max-h-112 overflow-y-auto pointer-events-auto"
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{description}</div>

          <Table className="w-full table-fixed">
            <Thead>
              <Tr>
                <Th className="w-[36%]">
                  <Trans>Document</Trans>
                </Th>
                <Th className="w-[34%]">
                  <Trans>Type</Trans>
                </Th>
                <Th className="w-[30%]">
                  <Trans>Status</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {documents.map((doc) => (
                <Tr key={`${doc.documentType}-${doc.id}`}>
                  <Td>
                    <Link
                      to={documentPath(doc)}
                      className="text-primary hover:underline"
                    >
                      {doc.readableId}
                    </Link>
                  </Td>
                  <Td>
                    <DocumentTypeLabel documentType={doc.documentType} />
                  </Td>
                  <Td>
                    <DocumentStatus doc={doc} />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>

          {count > documents.length && (
            <div className="text-xs text-muted-foreground">
              <Trans>
                And {count - documents.length} more — resolve these to see the
                rest.
              </Trans>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
