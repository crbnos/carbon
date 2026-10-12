// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildRecurringInvoicingDigests,
  type InvoiceRunResult
} from "./digest";

const results: InvoiceRunResult[] = [
  { invoiceId: "inv-1", sourceId: "ra-1", outcome: "emailed" },
  { invoiceId: "inv-2", sourceId: "ra-1", outcome: "held" },
  { invoiceId: "inv-3", sourceId: "ra-2", outcome: "posted" },
  { invoiceId: "inv-4", sourceId: "ra-2", outcome: "unsent" }
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
        body: "1 posted, 1 emailed, 1 need review",
        documentIds: ["inv-2"]
      },
      {
        recipient: { type: "user", userId: "user-bo" },
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
        body: "2 posted, 0 emailed, 1 need review",
        documentIds: ["inv-4"]
      },
      {
        recipient: { type: "group", groupIds: ["user-ana", "group-ar"] },
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
        [{ invoiceId: "inv-9", sourceId: "ra-1", outcome: "emailed" }],
        owners,
        []
      )
    ).toEqual([
      {
        recipient: { type: "user", userId: "user-ana" },
        body: "1 posted, 1 emailed, 0 need review",
        documentIds: ["inv-9"]
      }
    ]);
  });

  it("sends nothing when there is nothing to report", () => {
    expect(buildRecurringInvoicingDigests([], owners, ["group-ar"])).toEqual(
      []
    );
  });
});
