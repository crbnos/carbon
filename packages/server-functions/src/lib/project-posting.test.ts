// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  assertChargeable,
  buildBillableItem,
  buildProjectLedgerRow,
  ProjectChargeError,
  type ProjectPostingAsset,
  type ProjectPostingContext,
  type ProjectPostingElement,
  type ProjectPostingProject,
  resolveProjectPostingAccount,
  reverseBillableItem
} from "./project-posting";

const defaults = {
  projectExpenseAccount: "acct-expense",
  projectWorkInProgressAccount: "acct-wip",
  warrantyExpenseAccount: "acct-warranty",
  costOfGoodsSoldAccount: "acct-cogs",
  workInProgressAccount: "acct-inventory-wip"
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
    fixedAssetId: null,
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
    isFinalAsset: false,
    fixedAssetId: null,
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
    assets: new Map(),
    ...overrides
  };
}

describe("resolveProjectPostingAccount", () => {
  it("posts an Expense project with no element to Project Expense", () => {
    expect(resolveProjectPostingAccount(context(), "2026-03-01")).toEqual({
      treatment: "Expense",
      accountId: "acct-expense",
      fixedAssetId: null,
      postCapitalization: false
    });
  });

  it("posts a Contract project to Project Work in Progress", () => {
    const ctx = context({ project: project({ costTreatment: "Contract" }) });
    expect(resolveProjectPostingAccount(ctx, "2026-03-01")).toEqual({
      treatment: "Contract",
      accountId: "acct-wip",
      fixedAssetId: null,
      postCapitalization: false
    });
  });

  it("posts a Statistical project to no project account", () => {
    const ctx = context({ project: project({ costTreatment: "Statistical" }) });
    expect(resolveProjectPostingAccount(ctx, "2026-03-01")).toEqual({
      treatment: "Statistical",
      accountId: null,
      fixedAssetId: null,
      postCapitalization: false
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
      accountId: "acct-wip",
      fixedAssetId: null,
      postCapitalization: false
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
});

describe("resolveProjectPostingAccount: Capitalize", () => {
  function assets(...list: ProjectPostingAsset[]) {
    return new Map(list.map((asset) => [asset.id, asset]));
  }
  const projectAsset: ProjectPostingAsset = {
    id: "fa-project",
    status: "Under Construction",
    classAssetAccountId: "acct-cip"
  };

  it("posts a project with no final-asset elements to the project asset's CIP account", () => {
    const ctx = context({
      project: project({
        costTreatment: "Capitalize",
        fixedAssetId: "fa-project"
      }),
      element: element(),
      assets: assets(projectAsset)
    });
    expect(resolveProjectPostingAccount(ctx, "2026-03-01")).toEqual({
      treatment: "Capitalize",
      accountId: "acct-cip",
      fixedAssetId: "fa-project",
      postCapitalization: false
    });
  });

  it("posts an element under a final-asset branch to that branch's asset", () => {
    const branch = element({
      id: "el-branch",
      isFinalAsset: true,
      fixedAssetId: "fa-branch"
    });
    const ctx = context({
      project: project({
        costTreatment: "Capitalize",
        fixedAssetId: "fa-project"
      }),
      element: element({ parentId: "el-branch" }),
      ancestors: [branch],
      assets: assets(projectAsset, {
        id: "fa-branch",
        status: "Under Construction",
        classAssetAccountId: "acct-cip-branch"
      })
    });
    expect(resolveProjectPostingAccount(ctx, "2026-03-01")).toEqual({
      treatment: "Capitalize",
      accountId: "acct-cip-branch",
      fixedAssetId: "fa-branch",
      postCapitalization: false
    });
  });

  it("posts a late cost on an Active branch asset to its class asset account", () => {
    const ctx = context({
      project: project({ costTreatment: "Capitalize" }),
      element: element({ isFinalAsset: true, fixedAssetId: "fa-branch" }),
      assets: assets({
        id: "fa-branch",
        status: "Active",
        classAssetAccountId: "acct-machinery"
      })
    });
    expect(resolveProjectPostingAccount(ctx, "2026-03-01")).toEqual({
      treatment: "Capitalize",
      accountId: "acct-machinery",
      fixedAssetId: "fa-branch",
      postCapitalization: true
    });
  });

  it("refuses a Capitalize project with no asset", () => {
    const ctx = context({ project: project({ costTreatment: "Capitalize" }) });
    expect(() => resolveProjectPostingAccount(ctx, "2026-03-01")).toThrow(
      "This capital project has no asset under construction. Release the project first."
    );
  });
});

describe("resolveProjectPostingAccount: By Coverage", () => {
  const service = (overrides: Partial<ProjectPostingContext> = {}) =>
    context({
      project: project({
        identifier: "SVC000123",
        costTreatment: "By Coverage"
      }),
      ...overrides
    });
  const accountOf = (ctx: ProjectPostingContext, coverage: string | null) =>
    resolveProjectPostingAccount(
      ctx,
      "2028-02-01",
      coverage as Parameters<typeof resolveProjectPostingAccount>[2]
    ).accountId;

  it("posts each coverage to its account", () => {
    expect(accountOf(service(), "Warranty")).toBe("acct-warranty");
    expect(accountOf(service(), "Contract")).toBe("acct-cogs");
    expect(accountOf(service(), "Billable")).toBe("acct-cogs");
    expect(accountOf(service(), "Capitalized")).toBe("acct-inventory-wip");
  });

  it("posts a Contract charge to the contract project's account", () => {
    const ctx = service({
      project: project({
        identifier: "SVC000123",
        costTreatment: "By Coverage",
        parentProjectId: "prj-contract"
      }),
      parent: context({
        project: project({ id: "prj-contract", costTreatment: "Expense" })
      })
    });
    expect(accountOf(ctx, "Contract")).toBe("acct-expense");
    // A Statistical contract project keeps the natural account.
    const statistical = service({
      project: ctx.project,
      parent: context({
        project: project({ id: "prj-contract", costTreatment: "Statistical" })
      })
    });
    expect(accountOf(statistical, "Contract")).toBe("acct-cogs");
  });

  it("refuses a charge with no coverage, and a missing default by name", () => {
    expect(() => accountOf(service(), null)).toThrow(ProjectChargeError);
    expect(() =>
      accountOf(
        service({ defaults: { ...defaults, warrantyExpenseAccount: null } }),
        "Warranty"
      )
    ).toThrow(/Warranty Expense/);
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

describe("billable items", () => {
  const ledgerRow = {
    id: "pjl-1",
    companyId: "co-1",
    projectId: "prj-svc",
    projectElementId: "el-1",
    costType: "Labor" as const,
    quantity: 2,
    amount: 170,
    itemId: null,
    createdBy: "user-1"
  };

  it("prices 2 h of Labor at the service labor price", () => {
    const item = buildBillableItem({
      ledgerRow,
      coverage: "Billable",
      laborPrice: 95,
      partPrice: null,
      description: "Labor"
    });
    expect(item).toMatchObject({
      projectLedgerId: "pjl-1",
      quantity: 2,
      unitPrice: 95,
      amount: 190,
      coverage: "Billable",
      status: "Unbilled"
    });
  });

  it("keeps a Warranty part on the invoice at price 0", () => {
    const item = buildBillableItem({
      ledgerRow: {
        ...ledgerRow,
        costType: "Material",
        quantity: 3,
        amount: 42,
        itemId: "item-1"
      },
      coverage: "Warranty",
      laborPrice: 95,
      partPrice: 25,
      description: "Gasket"
    });
    expect(item).toMatchObject({
      itemId: "item-1",
      quantity: 3,
      unitPrice: 0,
      amount: 0,
      description: "Gasket (Covered by warranty)"
    });
    expect(
      buildBillableItem({
        ledgerRow,
        coverage: "Capitalized",
        laborPrice: 95,
        partPrice: null,
        description: "Labor"
      })
    ).toBeNull();
  });

  const billed = {
    id: "pbi-1",
    companyId: "co-1",
    projectId: "prj-svc",
    projectElementId: "el-1",
    projectLedgerId: "pjl-1",
    customerContractLineId: null,
    itemId: null,
    description: "Labor",
    quantity: 2,
    unitPrice: 95,
    amount: 190,
    coverage: "Billable" as const,
    status: "Unbilled" as const,
    createdBy: "user-1"
  };

  it("writes off an Unbilled item when its charge is reversed", () => {
    expect(reverseBillableItem(billed)).toEqual({
      update: { status: "Written Off", statusReason: "Reversed" }
    });
  });

  it("credits a Billed item with a negative Unbilled copy", () => {
    const { insert, update } = reverseBillableItem(
      { ...billed, status: "Billed" },
      { projectLedgerId: "pjl-2", createdBy: "user-2" }
    );
    expect(update).toBeUndefined();
    expect(insert).toMatchObject({
      projectLedgerId: "pjl-2",
      quantity: -2,
      unitPrice: 95,
      amount: -190,
      status: "Unbilled",
      reversalOfId: "pbi-1",
      createdBy: "user-2"
    });
  });
});
