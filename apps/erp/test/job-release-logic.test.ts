// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  bulkReleaseStartingPurchaseOrders,
  jobReleaseProblems,
  makeMethodsMissingOperations,
  outsideOperationsNeedingPurchaseOrders,
  resolveOperationSupplier,
  type SupplierProcessRef
} from "../app/modules/production/ui/Jobs/job-release-logic";

const op = (
  id: string,
  jobMakeMethodId: string,
  operationType = "Process",
  operationSupplierProcessId: string | null = null
) => ({ id, jobMakeMethodId, operationType, operationSupplierProcessId });

describe("makeMethodsMissingOperations", () => {
  it("flags the root and make-to-order sub-assemblies without operations", () => {
    const materials = [
      { jobMaterialMakeMethodId: "sub1", methodType: "Make to Order", kit: false },
      { jobMaterialMakeMethodId: "sub2", methodType: "Make to Order", kit: false },
      { jobMaterialMakeMethodId: null, methodType: "Pull from Inventory", kit: false }
    ];
    expect(
      makeMethodsMissingOperations("root", materials, [op("o1", "sub1")]).sort()
    ).toEqual(["root", "sub2"]);
  });

  it("does not require operations on kitted sub-assemblies", () => {
    const materials = [
      { jobMaterialMakeMethodId: "kit1", methodType: "Make to Order", kit: true }
    ];
    expect(
      makeMethodsMissingOperations("root", materials, [op("o1", "root")])
    ).toEqual([]);
  });
});

describe("outsideOperationsNeedingPurchaseOrders", () => {
  it("keeps outside operations with no PO line yet, supplier or not", () => {
    const ops = [
      op("a", "root", "Outside Processing", "sp1"),
      op("b", "root", "Outside Processing", "sp2"),
      op("c", "root", "Outside Processing", null),
      op("d", "root", "Process", "sp3")
    ];
    expect(
      outsideOperationsNeedingPurchaseOrders(ops, new Set(["b"])).map((o) => o.id)
    ).toEqual(["a", "c"]);
  });
});

describe("resolveOperationSupplier", () => {
  const sp = (id: string, processId: string): SupplierProcessRef => ({
    id,
    supplierId: `sup-${id}`,
    processId
  });
  const byId = new Map([["own", sp("own", "plating")]]);
  const byProcess = new Map([
    ["anodize", [sp("a1", "anodize")]],
    ["heat", [sp("h1", "heat"), sp("h2", "heat")]]
  ]);

  it("uses the operation's own supplier process first", () => {
    expect(
      resolveOperationSupplier(
        { operationSupplierProcessId: "own", processId: "heat" },
        byId,
        byProcess
      )
    ).toEqual({ supplierProcess: byId.get("own") });
  });

  it("falls back to the process's sole supplier", () => {
    expect(
      resolveOperationSupplier(
        { operationSupplierProcessId: null, processId: "anodize" },
        byId,
        byProcess
      )
    ).toEqual({ supplierProcess: sp("a1", "anodize") });
  });

  it("asks for a choice when the process has several, and flags none", () => {
    expect(
      resolveOperationSupplier(
        { operationSupplierProcessId: null, processId: "heat" },
        byId,
        byProcess
      )
    ).toEqual({ missing: "choose" });
    expect(
      resolveOperationSupplier(
        { operationSupplierProcessId: null, processId: "paint" },
        byId,
        byProcess
      )
    ).toEqual({ missing: "none" });
  });
});

describe("jobReleaseProblems", () => {
  const ready = {
    manufacturingBlocked: false,
    missingAssemblies: [],
    outsideOperationsWithoutSupplier: []
  };

  it("finds nothing to fix on a job that is ready", () => {
    expect(jobReleaseProblems(ready)).toEqual([]);
  });

  it("names every problem, assemblies together and operations one by one", () => {
    expect(
      jobReleaseProblems({
        manufacturingBlocked: true,
        missingAssemblies: [
          { description: "Bracket" },
          { description: "Housing" }
        ],
        outsideOperationsWithoutSupplier: [
          { description: "Heat Treat", missing: "choose" },
          { description: "Paint", missing: "none" }
        ]
      })
    ).toEqual([
      "manufacturing is blocked",
      "no operations on Bracket, Housing",
      "choose a supplier for Heat Treat on the job",
      "Paint has no supplier"
    ]);
  });
});

describe("bulkReleaseStartingPurchaseOrders", () => {
  it("starts every supplier on a new PO and asks for a choice when Drafts exist", () => {
    const result = bulkReleaseStartingPurchaseOrders([
      { supplierId: "s1", draftPurchaseOrders: [] },
      { supplierId: "s2", draftPurchaseOrders: [{ id: "po-a" }] }
    ]);
    expect(result.purchaseOrders).toEqual({ s1: "new", s2: "new" });
    expect([...result.suppliersToChoose]).toEqual(["s2"]);
  });

  it("keeps the PO an earlier slice created, with no choice to make", () => {
    // Slice 1 created po-1 for s1; slice 2 now reads it as a Draft of s1.
    const result = bulkReleaseStartingPurchaseOrders(
      [{ supplierId: "s1", draftPurchaseOrders: [{ id: "po-1" }] }],
      { s1: "po-1" }
    );
    expect(result.purchaseOrders).toEqual({ s1: "po-1" });
    expect(result.suppliersToChoose.size).toBe(0);
  });

  it("ignores a carried PO that is no longer a Draft of the supplier", () => {
    const result = bulkReleaseStartingPurchaseOrders(
      [{ supplierId: "s1", draftPurchaseOrders: [{ id: "po-other" }] }],
      { s1: "po-1" }
    );
    expect(result.purchaseOrders).toEqual({ s1: "new" });
    expect([...result.suppliersToChoose]).toEqual(["s1"]);
  });
});
