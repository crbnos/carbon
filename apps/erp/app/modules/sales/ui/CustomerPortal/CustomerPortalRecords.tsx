// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button } from "@carbon/react";
import { Link } from "react-router";

export type CustomerPortalOverview = {
  quoteOptions: { id: string; quoteId: string; status: string | null }[];
  nextCursor: {
    orders: string | null;
    quotes: string | null;
    requests: string | null;
    invoices: string | null;
    shipments: string | null;
  };
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

function RecordsPager({
  search,
  after,
  next,
  cursorKey,
  label
}: {
  search: string;
  after: string | null;
  next: string | null;
  cursorKey: "after" | "afterRequests";
  label: string;
}) {
  if (!after && !next) return null;
  const href = (cursor: string | null) => {
    const query = new URLSearchParams(search);
    if (cursor) query.set(cursorKey, cursor);
    else query.delete(cursorKey);
    return `?${query.toString()}`;
  };
  return (
    <div className="flex gap-2 border-t p-4">
      {after && (
        <Button variant="secondary" size="sm" asChild>
          <Link to={href(null)}>Newest {label}</Link>
        </Button>
      )}
      {next && (
        <Button variant="secondary" size="sm" asChild>
          <Link to={href(next)}>Older {label}</Link>
        </Button>
      )}
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
  after,
  afterRequests,
  search,
  onOrderQuote
}: {
  portalId: string;
  overview: CustomerPortalOverview;
  section: "quotes" | "invoices" | "shipments";
  after: string | null;
  afterRequests: string | null;
  search: string;
  onOrderQuote?: (quoteId: string) => void;
}) {
  if (section === "quotes") {
    if (
      !overview.quotes.length &&
      !overview.rfqs.length &&
      !after &&
      !afterRequests &&
      !overview.nextCursor.quotes &&
      !overview.nextCursor.requests
    )
      return <Empty>No quotes or requests are available yet.</Empty>;
    return (
      <section
        className="rounded-lg border bg-card shadow-sm"
        aria-label="Quotes"
      >
        <h2 className="border-b px-4 py-3 font-semibold">
          Quotes and requests
        </h2>
        {!overview.quotes.length && !overview.rfqs.length && (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No records on this page.
          </p>
        )}
        <h3 className="bg-muted/30 px-4 py-2 text-sm font-medium">Requests</h3>
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
        <RecordsPager
          search={search}
          after={afterRequests}
          next={overview.nextCursor.requests}
          cursorKey="afterRequests"
          label="requests"
        />
        <h3 className="border-t bg-muted/30 px-4 py-2 text-sm font-medium">
          Issued quotes
        </h3>
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
        <RecordsPager
          search={search}
          after={after}
          next={overview.nextCursor.quotes}
          cursorKey="after"
          label="quotes"
        />
      </section>
    );
  }

  if (section === "invoices") {
    if (!overview.invoices.length && !after && !overview.nextCursor.invoices)
      return <Empty>No invoices are available yet.</Empty>;
    return (
      <section
        className="rounded-lg border bg-card shadow-sm"
        aria-label="Invoices"
      >
        <h2 className="border-b px-4 py-3 font-semibold">Invoices</h2>
        {!overview.invoices.length && (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No downloadable invoices on this page.
          </p>
        )}
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
        <RecordsPager
          search={search}
          after={after}
          next={overview.nextCursor.invoices}
          cursorKey="after"
          label="invoices"
        />
      </section>
    );
  }

  if (!overview.shipments.length && !after && !overview.nextCursor.shipments)
    return <Empty>No packing slips are available yet.</Empty>;
  return (
    <section
      className="rounded-lg border bg-card shadow-sm"
      aria-label="Packing slips"
    >
      <h2 className="border-b px-4 py-3 font-semibold">
        Shipments and packing slips
      </h2>
      {!overview.shipments.length && (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          No downloadable packing slips on this page.
        </p>
      )}
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
      <RecordsPager
        search={search}
        after={after}
        next={overview.nextCursor.shipments}
        cursorKey="after"
        label="packing slips"
      />
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
