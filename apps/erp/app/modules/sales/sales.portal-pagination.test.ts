// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { storedDocumentPdfName } from "@carbon/files";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  getCustomerPortalOverview,
  getCustomerPortalReleaseOptions
} from "./sales.service";

type Row = Record<string, unknown>;

function portalClient(rows: Record<string, Row[]>) {
  const calls: {
    table: string;
    ids: readonly string[] | null;
    limit: number | null;
  }[] = [];
  const client = {
    from(table: string) {
      return {
        select() {
          const equals: [string, unknown][] = [];
          const contains: [string, readonly string[]][] = [];
          const order: { column: string; ascending: boolean }[] = [];
          let after: string | null = null;
          let pageLimit: number | null = null;
          const result = () => {
            let matching = (rows[table] ?? []).filter(
              (row) =>
                equals.every(([column, value]) => row[column] === value) &&
                contains.every(([column, ids]) =>
                  ids.includes(String(row[column] ?? ""))
                )
            );
            matching = matching.sort((a, b) => {
              for (const { column, ascending } of order) {
                const left = String(a[column] ?? "");
                const right = String(b[column] ?? "");
                const comparison = left.localeCompare(right);
                if (comparison) return ascending ? comparison : -comparison;
              }
              return 0;
            });
            if (after) {
              const index = matching.findIndex((row) =>
                after?.includes(String(row.id))
              );
              matching = index < 0 ? [] : matching.slice(index + 1);
            }
            calls.push({
              table,
              ids:
                contains.find(
                  ([column]) => column === "id" || column === "sourceDocumentId"
                )?.[1] ?? null,
              limit: pageLimit
            });
            return matching;
          };
          const query = {
            eq(column: string, value: unknown) {
              equals.push([column, value]);
              return query;
            },
            not: () => query,
            order(column: string, options?: { ascending?: boolean }) {
              order.push({ column, ascending: options?.ascending ?? true });
              return query;
            },
            in(column: string, ids: readonly string[]) {
              contains.push([column, ids]);
              return query;
            },
            or(filter: string) {
              after = filter;
              return query;
            },
            limit(value: number) {
              pageLimit = value;
              return query;
            },
            range(from: number, to: number) {
              return Promise.resolve({
                data: result().slice(from, to + 1),
                error: null
              });
            },
            then(resolve: (value: { data: Row[]; error: null }) => unknown) {
              return Promise.resolve({
                data: result().slice(0, pageLimit ?? undefined),
                error: null
              }).then(resolve);
            }
          };
          return query;
        }
      };
    }
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

const scope = { companyId: "company", customerId: "account" };
const createdAt = "2026-11-12T12:00:00Z";

function order(index: number) {
  return {
    id: `order-${String(index).padStart(4, "0")}`,
    salesOrderId: `SO-${index}`,
    customerReference: null,
    orderDate: "2026-11-12",
    status: "Confirmed",
    opportunityId: "opportunity",
    companyId: scope.companyId,
    customerId: scope.customerId
  };
}

function pdf(
  sourceDocument: string,
  sourceDocumentId: string,
  readableId: string
) {
  const name = storedDocumentPdfName(readableId, createdAt);
  return {
    id: `pdf-${sourceDocumentId}`,
    name,
    path: `${scope.companyId}/opportunity/opportunity/${name}`,
    sourceDocument,
    sourceDocumentId,
    companyId: scope.companyId,
    active: true,
    type: "PDF"
  };
}

describe("portal history pagination", () => {
  it("loads only the selected orders, batches ids, and keeps documents beyond the row cap", async () => {
    const orders = Array.from({ length: 1001 }, (_, index) => order(index));
    const last = orders.at(-1)!;
    const documents = [
      ...Array.from({ length: 1000 }, (_, index) => ({
        id: `unrelated-${index}`,
        name: `other-${index}.pdf`,
        path: `${scope.companyId}/opportunity/opportunity/other-${index}.pdf`,
        sourceDocument: "Sales Order",
        sourceDocumentId: last.id,
        companyId: scope.companyId,
        active: true,
        type: "PDF"
      })),
      pdf("Sales Order", last.id, last.salesOrderId)
    ];
    const { client, calls } = portalClient({
      salesOrder: orders,
      document: documents
    });
    const overview = await getCustomerPortalOverview(client, scope, {
      section: "orders",
      orderSalesOrderIds: [orders[0].salesOrderId, last.salesOrderId]
    });
    expect(overview.error).toBeNull();
    expect(overview.data?.orders).toHaveLength(2);
    expect(
      overview.data?.orders.find((row) => row.id === last.id)
        ?.hasAcknowledgement
    ).toBe(true);

    const options = await getCustomerPortalReleaseOptions(client, scope);
    expect(options.error).toBeNull();
    expect(options.data?.files).toHaveLength(1001);
    expect(
      options.data?.files.some((file) => file.id === `pdf-${last.id}`)
    ).toBe(true);
    const documentCalls = calls.filter((call) => call.table === "document");
    expect(documentCalls.length).toBeGreaterThan(10);
    expect(
      documentCalls.every((call) => call.ids !== null && call.ids.length <= 100)
    ).toBe(true);
  });

  it("paginates quotes with stable cursors", async () => {
    const quotes = Array.from({ length: 1001 }, (_, index) => ({
      id: `quote-${String(index).padStart(4, "0")}`,
      quoteId: `Q-${index}`,
      revisionId: 0,
      customerReference: null,
      expirationDate: null,
      status: "Sent",
      opportunityId: "opportunity",
      createdAt,
      companyId: scope.companyId,
      customerId: scope.customerId
    }));
    const documents = quotes.map((quote) =>
      pdf("Quote", quote.id, quote.quoteId)
    );
    const { client, calls } = portalClient({
      quote: quotes,
      document: documents
    });
    const first = await getCustomerPortalOverview(client, scope, {
      section: "quotes"
    });
    expect(first.error).toBeNull();
    expect(first.data?.quotes).toHaveLength(50);
    expect(first.data?.nextCursor.quotes).toBeTruthy();

    const second = await getCustomerPortalOverview(client, scope, {
      section: "quotes",
      after: first.data?.nextCursor.quotes
    });
    expect(second.error).toBeNull();
    expect(second.data?.quotes[0]?.id).toBe("quote-0050");
    let current = second;
    let pages = 2;
    while (current.data?.nextCursor.quotes) {
      current = await getCustomerPortalOverview(client, scope, {
        section: "quotes",
        after: current.data.nextCursor.quotes
      });
      pages += 1;
      expect(current.error).toBeNull();
    }
    expect(pages).toBe(21);
    expect(current.data?.quotes.at(-1)?.id).toBe("quote-1000");
    expect(
      calls
        .filter((call) => call.table === "quote")
        .every((call) => call.limit !== null)
    ).toBe(true);
    expect(calls.some((call) => call.table === "salesOrder")).toBe(false);
  });
});
