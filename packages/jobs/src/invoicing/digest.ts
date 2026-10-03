// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Who hears about a recurring-billing run, and what they hear. Every source
// document's owner (an agreement's salesperson, else its creator) gets one
// digest over THEIR invoices with no setup; the company's "Also notify" group
// gets one digest over all of them. An owner who is also in that group gets
// only the company digest, never both.
// Spec: .ai/specs/2026-10-02-rental-invoice-automation.md (plan decision 9)

export type InvoiceRunOutcome = "posted" | "emailed" | "held" | "unsent";

export type InvoiceRunResult = {
  invoiceId: string;
  /** The recurring source document the invoice was drafted from. */
  sourceId: string;
  outcome: InvoiceRunOutcome;
};

export type RecurringInvoicingDigest = {
  recipient:
    | { type: "user"; userId: string }
    | { type: "group"; groupIds: string[] };
  body: string;
  documentIds: string[];
};

function summarize(results: InvoiceRunResult[]) {
  // An emailed or unsent invoice was posted too.
  const posted = results.filter((r) => r.outcome !== "held");
  const emailed = results.filter((r) => r.outcome === "emailed");
  const review = results.filter(
    (r) => r.outcome === "held" || r.outcome === "unsent"
  );
  return {
    body: `${posted.length} posted, ${emailed.length} emailed, ${review.length} need review`,
    // What needs a person first; else what was posted (notify needs an id).
    documentIds: (review.length > 0 ? review : posted).map((r) => r.invoiceId)
  };
}

/**
 * @param owners source id → its owner's user id; sources whose owner cannot
 *   be notified (no owner, "system", not in the company) are left out.
 * @param groupIds the company's "Also notify" selection (users or groups).
 */
export function buildRecurringInvoicingDigests(
  results: InvoiceRunResult[],
  owners: Map<string, string>,
  groupIds: string[]
): RecurringInvoicingDigest[] {
  if (results.length === 0) return [];

  const listed = new Set(groupIds);
  const byOwner = new Map<string, InvoiceRunResult[]>();
  for (const result of results) {
    const owner = owners.get(result.sourceId);
    if (!owner || listed.has(owner)) continue;
    const list = byOwner.get(owner) ?? [];
    list.push(result);
    byOwner.set(owner, list);
  }

  const digests: RecurringInvoicingDigest[] = [...byOwner].map(
    ([userId, own]) => ({
      recipient: { type: "user", userId },
      ...summarize(own)
    })
  );
  if (groupIds.length > 0) {
    digests.push({
      recipient: { type: "group", groupIds },
      ...summarize(results)
    });
  }
  return digests;
}
