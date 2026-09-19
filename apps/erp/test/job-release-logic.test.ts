import { describe, expect, it } from "vitest";
import {
  makeMethodsMissingOperations,
  outsideOperationsNeedingPurchaseOrders
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
  it("keeps supplied outside operations that have no PO line yet", () => {
    const ops = [
      op("a", "root", "Outside Processing", "sp1"),
      op("b", "root", "Outside Processing", "sp2"),
      op("c", "root", "Outside Processing", null),
      op("d", "root", "Process", "sp3")
    ];
    expect(
      outsideOperationsNeedingPurchaseOrders(ops, new Set(["b"])).map((o) => o.id)
    ).toEqual(["a"]);
  });
});
