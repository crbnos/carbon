// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
  processId?: string | null;
};

export type SupplierProcessRef = {
  id: string;
  supplierId: string;
  processId: string;
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

// Outside operations release still has to purchase: no PO line exists yet.
// Which supplier each goes to is resolveOperationSupplier's question.
export function outsideOperationsNeedingPurchaseOrders<
  T extends ReleaseOperation
>(operations: T[], operationIdsWithPurchaseOrderLines: Set<string>): T[] {
  return operations.filter(
    (op) =>
      op.operationType === "Outside Processing" &&
      !operationIdsWithPurchaseOrderLines.has(op.id)
  );
}

// An outside operation's supplier on release: its own supplier process, else
// the sole supplier configured for its process — the same resolution as the
// job Release dialog and `create` purchaseOrderFromJob. A process with no
// supplier is "none"; one with several is "choose" (the job Release dialog
// asks; batch release has no per-operation picker, so it refuses instead).
export function resolveOperationSupplier(
  op: Pick<ReleaseOperation, "operationSupplierProcessId" | "processId">,
  supplierProcessById: Map<string, SupplierProcessRef>,
  supplierProcessesByProcessId: Map<string, SupplierProcessRef[]>
): { supplierProcess: SupplierProcessRef } | { missing: "none" | "choose" } {
  if (op.operationSupplierProcessId) {
    const own = supplierProcessById.get(op.operationSupplierProcessId);
    return own ? { supplierProcess: own } : { missing: "none" };
  }
  const candidates = op.processId
    ? (supplierProcessesByProcessId.get(op.processId) ?? [])
    : [];
  if (candidates.length === 1) return { supplierProcess: candidates[0]! };
  return { missing: candidates.length === 0 ? "none" : "choose" };
}

// What stands between a job and release, in words. A release with no dialog to
// settle these in (bulk job release, batch release) refuses the job and names
// them; the job's own Release dialog is where they are fixed.
export function jobReleaseProblems(job: {
  manufacturingBlocked: boolean;
  missingAssemblies: { description: string }[];
  outsideOperationsWithoutSupplier: {
    description: string;
    missing: "none" | "choose";
  }[];
}): string[] {
  return [
    ...(job.manufacturingBlocked ? ["manufacturing is blocked"] : []),
    ...(job.missingAssemblies.length > 0
      ? [
          `no operations on ${job.missingAssemblies
            .map((m) => m.description)
            .join(", ")}`
        ]
      : []),
    // No per-operation supplier picker here: an ambiguous or missing supplier
    // is settled on the job's own Release.
    ...job.outsideOperationsWithoutSupplier.map((op) =>
      op.missing === "choose"
        ? `choose a supplier for ${op.description} on the job`
        : `${op.description} has no supplier`
    )
  ];
}
