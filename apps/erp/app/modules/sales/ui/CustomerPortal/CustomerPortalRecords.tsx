// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button } from "@carbon/react";

export type CustomerPortalOverview = {
  rfqs: {
    id: string;
    salesRfqId: string | null;
    rfqId: string | null;
    customerReference: string | null;
    status: string;
    createdAt: string;
  }[];
  orders: {
    id: string;
    salesOrderId: string;
    customerReference: string | null;
    orderDate: string | null;
    status: string | null;
    hasAcknowledgement: boolean;
  }[];
  quotes: {
    id: string;
    quoteId: string;
    revisionId: number | null;
    customerReference: string | null;
    expirationDate: string | null;
    status: string | null;
    hasPdf: boolean;
  }[];
  invoices: {
    id: string;
    invoiceId: string;
    dateIssued: string | null;
    dateDue: string | null;
    status: string | null;
    totalAmount: number | null;
    currencyCode: string | null;
    customerReference: string | null;
    hasPdf: boolean;
  }[];
  shipments: {
    id: string;
    shipmentId: string;
    sourceDocumentId: string | null;
    postingDate: string | null;
    trackingNumber: string | null;
    hasPdf: boolean;
  }[];
  pendingPos: {
    id: string;
    poNumber: string | null;
    quoteId: string | null;
    requestedDelivery: string | null;
    createdAt: string;
    status: string;
  }[];
  releasedDocuments: {
    id: string;
    documentType: string;
    title: string;
    salesOrderId: string | null;
    shipmentId: string | null;
    createdAt: string;
  }[];
};

function Download({
  portalId,
  type,
  documentId,
  label
}: {
  portalId: string;
  type:
    | "acknowledgement"
    | "quote"
    | "invoice"
    | "packing-slip"
    | "coc"
    | "test-report";
  documentId: string;
  label: string;
}) {
  return (
    <Button variant="secondary" size="sm" asChild>
      <a
        href={`/share/customer/${portalId}/document/${type}/${documentId}`}
        download
      >
        {label}
      </a>
    </Button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-b p-4 last:border-b-0 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center">
      {children}
    </div>
  );
}

export function CustomerPortalPendingOrders({
  pendingPos
}: {
  pendingPos: CustomerPortalOverview["pendingPos"];
}) {
  if (!pendingPos.length) return null;
  return (
    <section
      className="rounded-lg border bg-card shadow-sm"
      aria-label="Purchase orders awaiting review"
    >
      <h2 className="border-b px-4 py-3 font-semibold">
        Purchase orders awaiting confirmation
      </h2>
      {pendingPos.map((po) => (
        <Row key={po.id}>
          <div className="font-medium">{po.poNumber || "Purchase order"}</div>
          <div className="text-sm text-muted-foreground">
            Received {po.createdAt.slice(0, 10)}
          </div>
          <div className="text-sm text-muted-foreground">
            {po.requestedDelivery
              ? `Requested ${po.requestedDelivery}`
              : "Delivery to confirm"}
          </div>
          <div className="text-sm font-medium text-amber-700 dark:text-amber-300">
            {po.status === "Pending" ? "Awaiting confirmation" : po.status}
          </div>
        </Row>
      ))}
    </section>
  );
}

export function CustomerPortalRecords({
  portalId,
  overview,
  section,
  onOrderQuote
}: {
  portalId: string;
  overview: CustomerPortalOverview;
  section: "quotes" | "invoices" | "shipments";
  onOrderQuote?: (quoteId: string) => void;
}) {
  if (section === "quotes") {
    if (!overview.quotes.length && !overview.rfqs.length)
      return <Empty>No quotes or requests are available yet.</Empty>;
    return (
      <section
        className="rounded-lg border bg-card shadow-sm"
        aria-label="Quotes"
      >
        <h2 className="border-b px-4 py-3 font-semibold">
          Quotes and requests
        </h2>
        {overview.rfqs.map((rfq) => (
          <Row key={rfq.id}>
            <div>
              <div className="font-medium">
                {rfq.rfqId ?? "Request received"}
              </div>
              <div className="text-sm text-muted-foreground">
                {rfq.customerReference || "No customer reference"}
              </div>
            </div>
            <div className="text-sm">Received {rfq.createdAt.slice(0, 10)}</div>
            <div className="text-sm">
              {rfq.status === "Draft" ? "Being reviewed" : rfq.status}
            </div>
            <div />
          </Row>
        ))}
        {overview.quotes.map((quote) => (
          <Row key={quote.id}>
            <div>
              <div className="font-medium">
                {quote.quoteId}
                {quote.revisionId ? `-${quote.revisionId}` : ""}
              </div>
              <div className="text-sm text-muted-foreground">
                {quote.customerReference || "No customer reference"}
              </div>
            </div>
            <div className="text-sm">
              {quote.expirationDate ? `Valid to ${quote.expirationDate}` : ""}
            </div>
            <div className="text-sm">{quote.status}</div>
            <div className="flex flex-wrap gap-2">
              {quote.hasPdf && (
                <Download
                  portalId={portalId}
                  type="quote"
                  documentId={quote.id}
                  label="Quote PDF"
                />
              )}
              {quote.status === "Sent" && onOrderQuote && (
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  onClick={() => onOrderQuote(quote.id)}
                >
                  Send PO
                </Button>
              )}
            </div>
          </Row>
        ))}
      </section>
    );
  }

  if (section === "invoices") {
    if (!overview.invoices.length)
      return <Empty>No invoices are available yet.</Empty>;
    return (
      <section
        className="rounded-lg border bg-card shadow-sm"
        aria-label="Invoices"
      >
        <h2 className="border-b px-4 py-3 font-semibold">Invoices</h2>
        {overview.invoices.map((invoice) => (
          <Row key={invoice.id}>
            <div>
              <div className="font-medium">{invoice.invoiceId}</div>
              <div className="text-sm text-muted-foreground">
                {invoice.customerReference || "No customer reference"}
              </div>
            </div>
            <div className="text-sm">
              {invoice.dateIssued ? `Issued ${invoice.dateIssued}` : ""}
              {invoice.dateDue ? ` · Due ${invoice.dateDue}` : ""}
            </div>
            <div className="text-sm">
              {invoice.totalAmount != null
                ? `${invoice.currencyCode || ""} ${invoice.totalAmount.toLocaleString()}`
                : ""}
              {invoice.status ? ` · ${invoice.status}` : ""}
            </div>
            <div>
              {invoice.hasPdf && (
                <Download
                  portalId={portalId}
                  type="invoice"
                  documentId={invoice.id}
                  label="Invoice PDF"
                />
              )}
            </div>
          </Row>
        ))}
      </section>
    );
  }

  if (!overview.shipments.length)
    return <Empty>No packing slips are available yet.</Empty>;
  return (
    <section
      className="rounded-lg border bg-card shadow-sm"
      aria-label="Packing slips"
    >
      <h2 className="border-b px-4 py-3 font-semibold">
        Shipments and packing slips
      </h2>
      {overview.shipments.map((shipment) => (
        <Row key={shipment.id}>
          <div>
            <div className="font-medium">{shipment.shipmentId}</div>
            <div className="text-sm text-muted-foreground">
              {shipment.sourceDocumentId || ""}
            </div>
          </div>
          <div className="text-sm">
            {shipment.postingDate ? `Shipped ${shipment.postingDate}` : ""}
          </div>
          <div className="text-sm">
            {shipment.trackingNumber
              ? `Tracking ${shipment.trackingNumber}`
              : ""}
          </div>
          <div className="flex flex-wrap gap-2">
            {shipment.hasPdf && (
              <Download
                portalId={portalId}
                type="packing-slip"
                documentId={shipment.id}
                label="Packing slip"
              />
            )}
            {overview.releasedDocuments
              .filter((document) => document.shipmentId === shipment.id)
              .map((document) => (
                <Download
                  key={document.id}
                  portalId={portalId}
                  type={document.documentType === "CoC" ? "coc" : "test-report"}
                  documentId={document.id}
                  label={document.title}
                />
              ))}
          </div>
        </Row>
      ))}
    </section>
  );
}

export function CustomerPortalOrderDocuments({
  portalId,
  overview,
  orderId
}: {
  portalId: string;
  overview: CustomerPortalOverview;
  orderId: string;
}) {
  const order = overview.orders.find((entry) => entry.id === orderId);
  const released = overview.releasedDocuments.filter(
    (document) => document.salesOrderId === orderId
  );
  if (!order?.hasAcknowledgement && !released.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {order?.hasAcknowledgement && (
        <Download
          portalId={portalId}
          type="acknowledgement"
          documentId={orderId}
          label="Order acknowledgement"
        />
      )}
      {released.map((document) => (
        <Download
          key={document.id}
          portalId={portalId}
          type={document.documentType === "CoC" ? "coc" : "test-report"}
          documentId={document.id}
          label={document.title}
        />
      ))}
    </div>
  );
}
