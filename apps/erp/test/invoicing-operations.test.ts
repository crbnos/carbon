// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { describe, expect, it } from "vitest";
import { fromServerFn } from "../app/modules/shared/shared.service";
import { tieOutAdjustmentLines } from "../app/modules/invoicing/invoicing.service";

const unreachable = () => {
  throw new Error("must not be reached");
};

const context = () =>
  createServiceContext({
    actor: { type: "system", onBehalfOf: "user-1" },
    company: { id: "company-1", groupId: "group-1" },
    caller: {} as never,
    system: unreachable,
    pg: unreachable,
    kv: unreachable
  });

describe("a server function's refusal", () => {
  const refusal = (status: number, message: string) =>
    fromServerFn(context(), { status, message }, "Failed to void charge");

  it("keeps the server function's own message, in the category its status names", () => {
    // A generic string left the user looking at a Posted charge with no idea
    // why it stayed posted.
    expect(refusal(422, "Charge is already voided")).toMatchObject({
      category: "rule",
      message: "Charge is already voided"
    });
    expect(refusal(400, "The invoice has no lines").category).toBe(
      "validation"
    );
    expect(refusal(403, "No").category).toBe("forbidden");
    expect(refusal(404, "Gone").category).toBe("notFound");
    expect(refusal(409, "Changed").category).toBe("conflict");
    // A plain throw keeps its message at 500: an authored refusal, mapped as
    // `settle` maps it.
    expect(refusal(500, "Boom")).toMatchObject({
      category: "validation",
      message: "Boom"
    });
  });

  it("falls back to the operation's message when the failure has none", () => {
    // A data-layer failure arrives with an empty message by design.
    expect(refusal(500, "")).toMatchObject({
      category: "internal",
      message: "Failed to void charge"
    });
  });
});

describe("a tie-out adjustment", () => {
  const lines = (side: "receivables" | "payables", variance: number) =>
    tieOutAdjustmentLines({
      side,
      variance,
      controlAccount: "control",
      offsetAccount: "rounding",
      description: "adjustment"
    }).map(({ accountId, debit, credit }) => ({ accountId, debit, credit }));

  it("raises an understated receivables balance with a debit", () => {
    expect(lines("receivables", 12.5)).toEqual([
      { accountId: "control", debit: 12.5, credit: 0 },
      { accountId: "rounding", debit: 0, credit: 12.5 }
    ]);
    expect(lines("receivables", -3)).toEqual([
      { accountId: "control", debit: 0, credit: 3 },
      { accountId: "rounding", debit: 3, credit: 0 }
    ]);
  });

  it("raises an understated payables balance with a credit", () => {
    expect(lines("payables", 12.5)).toEqual([
      { accountId: "control", debit: 0, credit: 12.5 },
      { accountId: "rounding", debit: 12.5, credit: 0 }
    ]);
    expect(lines("payables", -3)).toEqual([
      { accountId: "control", debit: 3, credit: 0 },
      { accountId: "rounding", debit: 0, credit: 3 }
    ]);
  });
});
