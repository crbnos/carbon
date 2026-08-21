// Shared types for the batch planning board. Kept in the module (not the route)
// so components don't import types across the route boundary.

// Material properties of one BOM line, as returned by get_batchable_operations.
export type BatchMaterial = {
  itemReadableId: string | null;
  description: string | null;
  quantity: number | null;
  formId: string | null;
  formName: string | null;
  substanceId: string | null;
  substanceName: string | null;
  gradeId: string | null;
  gradeName: string | null;
  dimensionId: string | null;
  dimensionName: string | null;
  finishId: string | null;
  finishName: string | null;
};

export type BatchCandidate = {
  id: string;
  jobId: string;
  jobReadableId: string | null;
  jobDueDate: string | null;
  itemReadableId: string | null;
  itemDescription: string | null;
  description: string | null;
  operationQuantity: number | null;
  status: string | null;
  jobOperationBatchId: string | null;
  batchReadableId: string | null;
  batchStatus: "Active" | "Completing" | "Completed" | null;
  batchWorkCenterId: string | null;
  materials: BatchMaterial[];
};

export type BatchLaneData = {
  id: string;
  readableId: string;
  // Completing lanes render read-only (a stuck completion, waiting for a retry
  // in MES); Active lanes are full drag targets.
  status: "Active" | "Completing";
  workCenterId: string | null;
  members: BatchCandidate[];
};
