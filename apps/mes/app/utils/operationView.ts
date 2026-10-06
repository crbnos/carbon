// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
 * `null`/`undefined` and the default `Process` — falls back to the Operation view, so
 * the route is always safe to open (ADR-0001). `Outside Processing` maps there too,
 * but subcontracted work runs at the supplier: the operation and start routes refuse
 * it before any view renders.
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

/**
 * Subcontracted work runs at the supplier, never on the shop floor. The boards
 * hide it (get_active_job_operations_by_location); the operation view, the start
 * route and the production-event Start action refuse it with this message.
 */
export const OUTSIDE_PROCESSING_REFUSAL =
  "Outside processing is done by the supplier and can't be run on the shop floor";
