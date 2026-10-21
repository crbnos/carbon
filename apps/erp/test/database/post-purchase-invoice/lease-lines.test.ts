// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type LeaseAccount,
  type LeaseInvoiceLine,
  type LeasePostingFacts,
  type LeasePostingPayment,
  type LeaseStatus,
  resolveLeasePostingLine
} from "../../../app/modules/invoicing/invoicing.service";

const liability: LeaseAccount = {
  id: "liability",
  name: "Lease Liabilities",
  class: "Liability"
};
const operating: LeaseAccount = {
  id: "operating",
  name: "Operating Lease Expense",
  class: "Expense"
};
const variable: LeaseAccount = {
  id: "variable",
  name: "Variable Lease Expense",
  class: "Expense"
};

const payment = (
  overrides: Partial<LeasePostingPayment> = {}
): LeasePostingPayment => ({
  leaseId: "lease-1",
  amount: 10000,
  purchaseInvoiceLineId: "line-1",
  description: "Forklift FL-12",
  lesseeClassification: "Operating",
  ...overrides
});

function facts(
  overrides: {
    status?: LeaseStatus;
    payment?: LeasePostingPayment;
    accounts?: LeaseAccount[];
  } = {}
): LeasePostingFacts {
  const accounts = overrides.accounts ?? [liability, operating, variable];
  return {
    leases: new Map([["lease-1", { status: overrides.status ?? "Active" }]]),
    payments: new Map([["pay-1", overrides.payment ?? payment()]]),
    accounts: new Map(
      accounts.map((account) => [
        account === liability
          ? "liability"
          : account === operating
            ? "operating"
            : "variable",
        account
      ])
    )
  };
}

const line: LeaseInvoiceLine = {
  id: "line-1",
  leaseId: "lease-1",
  leasePaymentId: "pay-1",
  projectId: null
};
const nominal = { nominalBaseCost: 10000, totalBaseCost: 10000 };

describe("resolveLeasePostingLine", () => {
  it("debits a capitalized payment's liability, its extras to operating lease expense", () => {
    expect(resolveLeasePostingLine(line, nominal, facts())).toEqual({
      leaseId: "lease-1",
      account: liability,
      extrasAccount: operating
    });
    expect(
      resolveLeasePostingLine(
        line,
        nominal,
        facts({ payment: payment({ lesseeClassification: "Finance" }) })
      ).account
    ).toBe(liability);
  });

  it("expenses a short-term payment and a variable charge in full", () => {
    expect(
      resolveLeasePostingLine(
        line,
        { nominalBaseCost: 1000, totalBaseCost: 1100 },
        facts({
          payment: payment({ amount: 1000, lesseeClassification: "Short-Term" })
        })
      )
    ).toEqual({ leaseId: "lease-1", account: operating, extrasAccount: null });
    expect(
      resolveLeasePostingLine(
        { ...line, leasePaymentId: null },
        { nominalBaseCost: 250, totalBaseCost: 250 },
        facts()
      )
    ).toEqual({ leaseId: "lease-1", account: variable, extrasAccount: null });
  });

  it("refuses what the posting cannot book", () => {
    const refuse =
      (
        args: Partial<{
          line: Partial<LeaseInvoiceLine>;
          amounts: typeof nominal;
          facts: LeasePostingFacts;
        }>
      ) =>
      () =>
        resolveLeasePostingLine(
          { ...line, ...args.line },
          args.amounts ?? nominal,
          args.facts ?? facts()
        );

    expect(refuse({ line: { leaseId: null } })).toThrow(
      "has no lease selected"
    );
    expect(refuse({ facts: facts({ status: "Draft" }) })).toThrow(
      "Activate the lease before invoicing it"
    );
    expect(refuse({ facts: facts({ status: "Cancelled" }) })).toThrow(
      "The lease is cancelled"
    );
    // An ended lease still bills its last rows.
    expect(refuse({ facts: facts({ status: "Terminated" }) })).not.toThrow();
    expect(refuse({ line: { projectId: "project-1" } })).toThrow(
      "cannot be charged to a project"
    );
    expect(
      refuse({ facts: facts({ payment: payment({ leaseId: "lease-2" }) }) })
    ).toThrow("names a payment of another lease");
    expect(
      refuse({
        facts: facts({ payment: payment({ purchaseInvoiceLineId: "line-2" }) })
      })
    ).toThrow("billed by another invoice line");
    expect(
      refuse({
        facts: facts({ payment: payment({ lesseeClassification: null }) })
      })
    ).toThrow("Activate the lease before invoicing it");
    expect(
      refuse({ amounts: { nominalBaseCost: 9999.99, totalBaseCost: 9999.99 } })
    ).toThrow("must be 10000, its payment's amount");
    expect(
      refuse({ facts: facts({ accounts: [operating, variable] }) })
    ).toThrow("Set the lease (lessee) accounts");
    // The extras need the operating lease expense account; none, no need.
    expect(
      refuse({
        amounts: { nominalBaseCost: 10000, totalBaseCost: 10825 },
        facts: facts({ accounts: [liability, variable] })
      })
    ).toThrow("Set the lease (lessee) accounts");
    expect(
      refuse({ facts: facts({ accounts: [liability, variable] }) })
    ).not.toThrow();
  });
});
