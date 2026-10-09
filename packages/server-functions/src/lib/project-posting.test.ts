// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  assertChargeable,
  buildProjectLedgerRow,
  ProjectChargeError,
  type ProjectPostingContext,
  type ProjectPostingElement,
  type ProjectPostingProject,
  resolveProjectPostingAccount
} from "./project-posting";

const defaults = {
  projectExpenseAccount: "acct-expense",
  projectWorkInProgressAccount: "acct-wip"
};

function project(
  overrides: Partial<ProjectPostingProject> = {}
): ProjectPostingProject {
  return {
    id: "prj-1",
    identifier: "ST",
    status: "Released",
    costTreatment: "Expense",
    costAccountId: null,
    ...overrides
  };
}

function element(
  overrides: Partial<ProjectPostingElement> = {}
): ProjectPostingElement {
  return {
    id: "el-1",
    readableId: "ST-1",
    parentId: null,
    isChargeable: true,
    stateGroup: "Started",
    costTreatment: null,
    costTreatmentEffectiveFrom: null,
    costAccountId: null,
    ...overrides
  };
}

function context(
  overrides: Partial<ProjectPostingContext> = {}
): ProjectPostingContext {
  return {
    project: project(),
    element: null,
    ancestors: [],
    defaults,
    ...overrides
  };
}

describe("resolveProjectPostingAccount", () => {
  it("posts an Expense project with no element to Project Expense", () => {
    expect(resolveProjectPostingAccount(context(), "2026-03-01")).toEqual({
      treatment: "Expense",
      accountId: "acct-expense"
    });
  });

  it("posts a Contract project to Project Work in Progress", () => {
    const ctx = context({ project: project({ costTreatment: "Contract" }) });
    expect(resolveProjectPostingAccount(ctx, "2026-03-01")).toEqual({
      treatment: "Contract",
      accountId: "acct-wip"
    });
  });

  it("posts a Statistical project to no project account", () => {
    const ctx = context({ project: project({ costTreatment: "Statistical" }) });
    expect(resolveProjectPostingAccount(ctx, "2026-03-01")).toEqual({
      treatment: "Statistical",
      accountId: null
    });
  });

  it("applies an ancestor override only from its effective date", () => {
    const parent = element({
      id: "el-parent",
      costTreatment: "Contract",
      costTreatmentEffectiveFrom: "2026-03-01"
    });
    const ctx = context({
      element: element({ parentId: "el-parent" }),
      ancestors: [parent]
    });
    expect(resolveProjectPostingAccount(ctx, "2026-02-28").treatment).toBe(
      "Expense"
    );
    expect(resolveProjectPostingAccount(ctx, "2026-03-01")).toEqual({
      treatment: "Contract",
      accountId: "acct-wip"
    });
  });

  it("uses an explicit account on the element over the defaults", () => {
    const ctx = context({
      element: element({
        costTreatment: "Expense",
        costAccountId: "acct-explicit"
      })
    });
    expect(resolveProjectPostingAccount(ctx, "2026-03-01").accountId).toBe(
      "acct-explicit"
    );
  });

  it("refuses when the default account is not set", () => {
    const ctx = context({
      defaults: { ...defaults, projectExpenseAccount: null }
    });
    expect(() => resolveProjectPostingAccount(ctx, "2026-03-01")).toThrow(
      ProjectChargeError
    );
    expect(() => resolveProjectPostingAccount(ctx, "2026-03-01")).toThrow(
      /Set Project Expense in Account Defaults/
    );
  });

  it("refuses the Capitalize treatment", () => {
    const ctx = context({ project: project({ costTreatment: "Capitalize" }) });
    expect(() => resolveProjectPostingAccount(ctx, "2026-03-01")).toThrow(
      "The Capitalize treatment is not available yet"
    );
  });
});

describe("assertChargeable", () => {
  it("refuses a new charge on a Draft project, a Backlog element and a non-chargeable element", () => {
    expect(() =>
      assertChargeable(
        context({ project: project({ status: "Draft" }) }),
        "new"
      )
    ).toThrow(ProjectChargeError);
    expect(() =>
      assertChargeable(
        context({ element: element({ stateGroup: "Backlog" }) }),
        "new"
      )
    ).toThrow(ProjectChargeError);
    expect(() =>
      assertChargeable(
        context({ element: element({ isChargeable: false }) }),
        "new"
      )
    ).toThrow(ProjectChargeError);
    expect(() =>
      assertChargeable(context({ element: element() }), "new")
    ).not.toThrow();
  });

  it("accepts a commitment on a Completed element of an On Hold project, and refuses a Cancelled element", () => {
    expect(() =>
      assertChargeable(
        context({
          project: project({ status: "On Hold" }),
          element: element({ stateGroup: "Completed" })
        }),
        "commitment"
      )
    ).not.toThrow();
    expect(() =>
      assertChargeable(
        context({
          project: project({ status: "On Hold" }),
          element: element({ stateGroup: "Cancelled" })
        }),
        "commitment"
      )
    ).toThrow(ProjectChargeError);
  });

  it("names the project in the refusal", () => {
    expect(() =>
      assertChargeable(
        context({ project: project({ status: "Closed" }) }),
        "commitment"
      )
    ).toThrow(/Project ST is Closed/);
  });
});

describe("buildProjectLedgerRow", () => {
  it("rounds the amount and fills the optional columns with null", () => {
    const row = buildProjectLedgerRow({
      companyId: "co-1",
      projectId: "prj-1",
      projectElementId: null,
      postingDate: "2026-03-01",
      costType: "Labor",
      documentType: "Timesheet",
      documentId: "tse-1",
      quantity: 6,
      amount: 510.0000049,
      createdBy: "user-1"
    });
    expect(row.amount).toBe(510);
    expect(row.journalLineId).toBeNull();
    expect(row.reversalOfId).toBeNull();
  });
});
