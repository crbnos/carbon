// Per-operation classification that drives the MES view router (see
// .ai/specs/2026-07-14-mes-execution-views.md §2, §5.1). Orthogonal to operationType
// (Inside/Outside).
// "Operation" is the default and preserves today's single-screen behavior. Set per
// operation in the BOP editor; copied verbatim to jobOperation/quoteOperation by
// get-method.
export const operationKinds = ["Operation", "Assembly", "Inspection"] as const;

export type OperationKind = (typeof operationKinds)[number];

// Unified operation classification (Brad's Type+Kind merge): one user-facing field that
// collapses operationType (Inside/Outside) + operationKind (Operation/Assembly/Inspection)
// into a single choice. "Batch" is intentionally dropped — it's a tracking type, not an op
// type. The two underlying columns are still written/read, so costing
// (`operationType === "Outside"`) and the MES view router (operationKind) are unchanged; this
// is the authoring-UI half of the merge. A later migration can physically collapse the columns.
export const operationClassifications = [
  "Standard",
  "Assembly",
  "Inspection",
  "Outside Processing"
] as const;

export type OperationClassification = (typeof operationClassifications)[number];

// Derive the single classification from the two stored columns.
export function classificationFromTypeKind(
  operationType: string | null | undefined,
  operationKind: string | null | undefined
): OperationClassification {
  if (operationType === "Outside") return "Outside Processing";
  if (operationKind === "Assembly") return "Assembly";
  if (operationKind === "Inspection") return "Inspection";
  return "Standard";
}

// Map the single classification back to the two stored columns.
export function typeKindFromClassification(classification: string): {
  operationType: "Inside" | "Outside";
  operationKind: OperationKind;
} {
  switch (classification) {
    case "Outside Processing":
      return { operationType: "Outside", operationKind: "Operation" };
    case "Assembly":
      return { operationType: "Inside", operationKind: "Assembly" };
    case "Inspection":
      return { operationType: "Inside", operationKind: "Inspection" };
    default:
      return { operationType: "Inside", operationKind: "Operation" };
  }
}
