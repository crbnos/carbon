// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildRecurringInvoicingDigests,
  type InvoiceRunResult
} from "./digest";

const sale = (
  invoiceId: string,
  sourceId: string,
  outcome: InvoiceRunResult["outcome"]
): InvoiceRunResult => ({
  invoiceId,
  documentType: "salesInvoice",
  sourceId,
  outcome
});
const leaseDraft = (invoiceId: string, sourceId: string): InvoiceRunResult => ({
  invoiceId,
  documentType: "purchaseInvoice",
  sourceId,
  outcome: "drafted"
});

const results: InvoiceRunResult[] = [
  sale("inv-1", "ra-1", "emailed"),
  sale("inv-2", "ra-1", "held"),
  sale("inv-3", "ra-2", "posted"),
  sale("inv-4", "ra-2", "unsent")
];
const owners = new Map([
  ["ra-1", "user-ana"],
  ["ra-2", "user-bo"]
]);

describe("buildRecurringInvoicingDigests", () => {
  it("gives each owner a digest over their own invoices", () => {
    expect(buildRecurringInvoicingDigests(results, owners, [])).toEqual([
      {
        recipient: { type: "user", userId: "user-ana" },
        documentType: "salesInvoice",
        body: "1 posted, 1 emailed, 1 need review",
        documentIds: ["inv-2"]
      },
      {
        recipient: { type: "user", userId: "user-bo" },
        documentType: "salesInvoice",
        body: "2 posted, 0 emailed, 1 need review",
        documentIds: ["inv-4"]
      }
    ]);
  });

  it("sends an owner who is in the group only the company digest", () => {
    const digests = buildRecurringInvoicingDigests(results, owners, [
      "user-ana",
      "group-ar"
    ]);
    expect(digests).toEqual([
      {
        recipient: { type: "user", userId: "user-bo" },
        documentType: "salesInvoice",
        body: "2 posted, 0 emailed, 1 need review",
        documentIds: ["inv-4"]
      },
      {
        recipient: { type: "group", groupIds: ["user-ana", "group-ar"] },
        documentType: "salesInvoice",
        body: "3 posted, 1 emailed, 2 need review",
        documentIds: ["inv-2", "inv-4"]
      }
    ]);
  });

  it("sends only owner digests when nobody else is listed", () => {
    const digests = buildRecurringInvoicingDigests(results, owners, []);
    expect(digests.map((d) => d.recipient.type)).toEqual(["user", "user"]);
  });

  it("links the posted invoices when nothing needs review", () => {
    expect(
      buildRecurringInvoicingDigests(
        [sale("inv-9", "ra-1", "emailed")],
        owners,
        []
      )
    ).toEqual([
      {
        recipient: { type: "user", userId: "user-ana" },
        documentType: "salesInvoice",
        body: "1 posted, 1 emailed, 0 need review",
        documentIds: ["inv-9"]
      }
    ]);
  });

  it("sends lease drafts as their own notification, linking to the purchase invoices", () => {
    expect(
      buildRecurringInvoicingDigests(
        [
          leaseDraft("pi-1", "lease-1"),
          leaseDraft("pi-2", "lease-1"),
          sale("inv-2", "ra-1", "held"),
          sale("inv-9", "ra-1", "posted")
        ],
        new Map([...owners, ["lease-1", "user-ana"]]),
        []
      )
    ).toEqual([
      {
        recipient: { type: "user", userId: "user-ana" },
        documentType: "salesInvoice",
        body: "1 posted, 0 emailed, 1 need review",
        documentIds: ["inv-2"]
      },
      {
        recipient: { type: "user", userId: "user-ana" },
        documentType: "purchaseInvoice",
        body: "2 lease invoices drafted",
        documentIds: ["pi-1", "pi-2"]
      }
    ]);
  });

  it("sends only the lease notification when nothing else was billed", () => {
    expect(
      buildRecurringInvoicingDigests([leaseDraft("pi-1", "lease-1")], owners, [
        "group-ap"
      ])
    ).toEqual([
      {
        recipient: { type: "group", groupIds: ["group-ap"] },
        documentType: "purchaseInvoice",
        body: "1 lease invoice drafted",
        documentIds: ["pi-1"]
      }
    ]);
  });

  it("sends nothing when there is nothing to report", () => {
    expect(buildRecurringInvoicingDigests([], owners, ["group-ar"])).toEqual(
      []
    );
  });
});
