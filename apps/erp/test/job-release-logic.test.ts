import { describe, expect, it } from "vitest";
import {
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
