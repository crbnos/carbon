// Release checks shared by the job Release dialog and batch release, so a job
// released as part of a batch is held to exactly the rules the job page applies.
// Pure — no JSX/lingui — and unit-tested by apps/erp/test/job-release-logic.test.ts.

export type ReleaseMaterial = {
  jobMaterialMakeMethodId: string | null;
  methodType: string | null;
  kit: boolean | null;
};

export type ReleaseOperation = {
  id: string;
  jobMakeMethodId: string | null;
  operationType: string | null;
  operationSupplierProcessId: string | null;
};

// The job's own make method plus every Make-to-Order sub-assembly that is not
// kitted must carry at least one operation, or nothing on the floor builds it.
export function makeMethodsMissingOperations(
  rootMakeMethodId: string | null,
  materials: ReleaseMaterial[],
  operations: ReleaseOperation[]
): string[] {
  const kitted = new Set(
    materials
      .filter((m) => m.jobMaterialMakeMethodId && m.kit)
      .map((m) => m.jobMaterialMakeMethodId)
  );
  const required = new Set<string>();
  for (const m of materials) {
    if (
      m.jobMaterialMakeMethodId &&
      m.methodType === "Make to Order" &&
      !kitted.has(m.jobMaterialMakeMethodId)
    ) {
      required.add(m.jobMaterialMakeMethodId);
    }
  }
  if (rootMakeMethodId) required.add(rootMakeMethodId);

  const withOperations = new Set(operations.map((op) => op.jobMakeMethodId));
  return [...required].filter((id) => !withOperations.has(id));
}

// Outside operations that release must put on a purchase order: a supplier
// process is set and no PO line exists yet. Operations without a supplier are
// not purchased here (the job Release dialog has always skipped them).
export function outsideOperationsNeedingPurchaseOrders<
  T extends ReleaseOperation
>(operations: T[], operationIdsWithPurchaseOrderLines: Set<string>): T[] {
  return operations.filter(
    (op) =>
      op.operationType === "Outside Processing" &&
      !!op.operationSupplierProcessId &&
      !operationIdsWithPurchaseOrderLines.has(op.id)
  );
}
