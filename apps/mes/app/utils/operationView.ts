/**
 * The view resolver (Workstream C). A pure mapping from an operation's classification
 * (`operationKind`) to the execution view the operator should land on. The MES operation
 * route calls this and renders the matching component, so a single route + deep link
 * survives a kind change. See .ai/specs/2026-07-14-mes-execution-views.md §2
 * ("operationKind") and §5.1.
 *
 * Tracking type is orthogonal — it decides per-unit vs. batch cadence *inside* a view,
 * never which view.
 */
export type OperationKind = "Operation" | "Assembly" | "Inspection";

export type OperationView = "operation" | "assembly" | "inspection";

/**
 * Resolve the view for a kind. Anything unrecognized — including `null`/`undefined` and
 * the default `Operation` member — falls back to the Operation view, so the route is
 * always safe to open (ADR-0001).
 */
export function resolveOperationView(
  kind: OperationKind | null | undefined
): OperationView {
  switch (kind) {
    case "Assembly":
      return "assembly";
    case "Inspection":
      return "inspection";
    default:
      return "operation";
  }
}
