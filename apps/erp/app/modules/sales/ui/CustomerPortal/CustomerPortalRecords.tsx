// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button } from "@carbon/react";
import { Link } from "react-router";

export type CustomerPortalOverview = {
  nextCursor: {
    quotes: string | null;
    invoices: string | null;
    shipments: string | null;
  };
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
  label
}: {
  search: string;
  after: string | null;
  next: string | null;
  label: string;
}) {
  if (!after && !next) return null;
  const href = (cursor: string | null) => {
    const query = new URLSearchParams(search);
    query.delete("afterRequests");
    if (cursor) query.set("after", cursor);
    else query.delete("after");
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

export function CustomerPortalRecords({
  portalId,
  overview,
  section,
  after,
  search
}: {
  portalId: string;
  overview: CustomerPortalOverview;
  section: "quotes" | "invoices" | "shipments";
  after: string | null;
  search: string;
}) {
  if (section === "quotes") {
    if (!overview.quotes.length && !after && !overview.nextCursor.quotes)
      return <Empty>No quotes are available yet.</Empty>;
    return (
      <section
        className="rounded-lg border bg-card shadow-sm"
        aria-label="Quotes"
      >
        <h2 className="border-b px-4 py-3 font-semibold">Issued quotes</h2>
        {!overview.quotes.length && (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No records on this page.
          </p>
        )}
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
            </div>
          </Row>
        ))}
        <RecordsPager
          search={search}
          after={after}
          next={overview.nextCursor.quotes}
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
