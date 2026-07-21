/**
 * The view resolver (Workstream C). A pure mapping from an operation's classification
 * (`operationType`) to the execution view the operator should land on. The MES operation
 * route calls this and renders the matching component, so a single route + deep link
 * survives a type change. See .ai/specs/2026-07-20-operation-type-consolidation.md and
 * .ai/specs/2026-07-14-mes-execution-views.md §5.1.
 *
 * Tracking type is orthogonal — it decides per-unit vs. batch cadence *inside* a view,
 * never which view.
 */
export type OperationType =
  | "Process"
  | "Assembly"
  | "Inspection"
  | "Outside Processing";

export type OperationView = "operation" | "assembly" | "inspection";

/**
 * Resolve the view for an operation type. Anything unrecognized — including
 * `null`/`undefined`, the default `Process`, and `Outside Processing` (subcontracted
 * work has no execution view of its own) — falls back to the Operation view, so the
 * route is always safe to open (ADR-0001).
 */
export function resolveOperationView(
  type: OperationType | null | undefined
): OperationView {
  switch (type) {
    case "Assembly":
      return "assembly";
    case "Inspection":
      return "inspection";
    default:
      return "operation";
  }
}
