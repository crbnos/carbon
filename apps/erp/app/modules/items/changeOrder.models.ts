import type { PostgrestError } from "@supabase/supabase-js";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { nonConformancePriority } from "../quality/quality.models";
// supersessionModes is an item-domain const (mirrors the DB "supersessionMode"
// enum); reuse the single canonical declaration in items.models.
import { supersessionModes } from "./items.models";

// Error shape returned by the change order service functions: either a real
// Supabase PostgrestError or a hand-built message (sequence/lookup failures that
// don't originate from a query). One alias so callers get a consistent contract.
export type ChangeOrderError = PostgrestError | { message: string };

// =============================================================================
// Change Orders — validators, enums, and the stage state machine.
//
// A sub-area of the Items module, modeled on Quality. The header evolves the
// existing `changeOrder` table. v2: a CO's per-affected-item edits live on a
// REAL CO-owned Draft make method (no staged mirror tables); the change type
// drives the release action. Validators here cover the header, affected items +
// change type, cutover, manual supersession, and freeform actions.
// =============================================================================

// changeOrder.type — the legacy category enum on the header. Retained (the
// column still exists); the primary "Category" is `changeOrderTypeId` (a row in
// the changeOrderType lookup, reseeded to Design improvement / Obsolescence /
// Cost reduction).
export const changeOrderType = [
  "Engineering",
  "Manufacturing",
  "Documentation"
] as const;

// V1 stage flow (forward, one step at a time). Broadcast on Start /
// Implementation / Done; silent on Draft / Engineering Complete.
export const changeOrderStatus = [
  "Draft",
  "Start",
  "Engineering Complete",
  "Implementation",
  "Done"
] as const;

export const changeOrderTaskStatus = [
  "Pending",
  "In Progress",
  "Completed",
  "Skipped"
] as const;

// v2 per-affected-item change type. Drives the release action + which editing
// surface is shown (see the Q2 capability matrix): Version = new method version on
// the same item (BoM/BoP, no supersession); Revision = new revision item
// (attributes/docs only, auto old-rev→new-rev supersession); New Part = new P/N
// derived from + auto-superseding the affected part (BoM/BoP + attributes).
export const changeOrderChangeTypes = [
  "Version",
  "Revision",
  "New Part"
] as const;
export type ChangeOrderChangeType = (typeof changeOrderChangeTypes)[number];

// changeOrder.priority reuses quality's nonConformancePriority DB enum.
export const changeOrderPriority = nonConformancePriority;

// -----------------------------------------------------------------------------
// Stage state machine (G8 — one place). Forward-only, single step. This map only
// encodes the allowed shape of a transition.
// -----------------------------------------------------------------------------
export const changeOrderStatusTransitions: Record<
  (typeof changeOrderStatus)[number],
  (typeof changeOrderStatus)[number][]
> = {
  Draft: ["Start"],
  Start: ["Engineering Complete"],
  "Engineering Complete": ["Implementation"],
  Implementation: ["Done"],
  Done: []
};

export function isAllowedChangeOrderTransition(
  from: string | null | undefined,
  to: string | null | undefined
): boolean {
  if (!from || !to || from === to) return false;
  const allowed =
    changeOrderStatusTransitions[from as (typeof changeOrderStatus)[number]];
  if (!allowed) return false;
  return (allowed as readonly string[]).includes(to);
}

// The stages that broadcast a team notification on entry.
export const changeOrderBroadcastStages: (typeof changeOrderStatus)[number][] =
  ["Start", "Implementation", "Done"];

// "Open" = every stage before the record is closed at Done. Used by the item
// open-CO alert and the single-open-CO guard.
export const changeOrderOpenStatuses: (typeof changeOrderStatus)[number][] = [
  "Draft",
  "Start",
  "Engineering Complete",
  "Implementation"
];

// Locked once Done — the record is closed and part of the audit trail.
export function isChangeOrderLocked(
  status: string | null | undefined
): boolean {
  return status === "Done";
}

// Content (reason/description/products/BOM changes/actions) is editable until
// the CO is closed.
export function canEditChangeOrder(status: string | null | undefined): boolean {
  return !isChangeOrderLocked(status);
}

// -----------------------------------------------------------------------------
// Header
// -----------------------------------------------------------------------------
export const changeOrderValidator = z.object({
  id: zfd.text(z.string().optional()),
  changeOrderId: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  reasonForChange: zfd.text(z.string().optional()),
  description: zfd.text(z.string().optional()),
  type: z.enum(changeOrderType).optional(),
  priority: z.enum(nonConformancePriority).optional(),
  changeOrderTypeId: zfd.text(z.string().optional()),
  nonConformanceId: zfd.text(z.string().optional()),
  openDate: z.string().min(1, { message: "Open date is required" }),
  dueDate: zfd.text(z.string().optional()),
  assignee: zfd.text(z.string().optional()),
  // Optional affected Parts/Tools to attach at create time — each is added as a
  // Version affected item (Buy items coerced to Revision service-side). More can
  // be added later on the CO detail. Only consumed by the create action.
  affectedItemIds: zfd.repeatableOfType(z.string()).optional()
});

// Status transition (used by the $id.status route). fromStatus drives a
// compare-and-swap so a stale/concurrent transition is rejected.
export const changeOrderStatusValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  fromStatus: z.enum(changeOrderStatus),
  status: z.enum(changeOrderStatus),
  assignee: zfd.text(z.string().optional())
});

// =============================================================================
// Top-to-bottom change content (v2) — affected items + per-item change type +
// cutover + manual supersession. The user selects affected parts first; each
// part's edits live on a REAL CO-owned Draft make method edited via the normal
// BillOfMaterial/BillOfProcess/PartProperties editors (no staged mirror tables).
// All validators are flat objects (no discriminated unions / heavy generics) to
// stay clear of TS2589 when threaded through @carbon/form's `validator()`.
// =============================================================================

// Affected item — the part the user selects to change. Adding one creates a
// CO-owned Draft make method per the change type (service side).
export const changeOrderAffectedItemValidator = z.object({
  id: zfd.text(z.string().optional()),
  changeOrderId: z.string().min(1, { message: "Change order is required" }),
  itemId: z.string().min(1, { message: "Item is required" }),
  changeType: z.enum(changeOrderChangeTypes).default("Version")
});

// Switch the change type on an existing affected item (rebuilds its CO-owned
// Draft make method for the new type — see updateChangeOrderAffectedItemChangeType).
export const changeOrderAffectedItemChangeTypeValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  changeType: z.enum(changeOrderChangeTypes)
});

// Per-item revision cutover config (Q3): existence of the oldRev→newRev
// supersession is automatic at release; the user only tunes mode + dates here.
export const changeOrderAffectedItemCutoverValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  supersessionMode: z.enum(supersessionModes),
  discontinuationDate: zfd.text(z.string().optional()),
  successorEffectivityDate: zfd.text(z.string().optional())
});

// Action task status transition (Start / Complete / Reopen). Actions are
// instantiated from templates (see changeOrderRequiredAction); there's no
// freeform-create validator.
export const changeOrderActionStatusValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  status: z.enum(changeOrderTaskStatus)
});

// Configurable default actions (changeOrderRequiredAction templates) — the
// per-company set a new change order is seeded from. Configured like Issue Types.
export const changeOrderRequiredActionValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  active: zfd.checkbox()
});

// -----------------------------------------------------------------------------
// Diff types (Q5 git-style) — one shape reused for the pre-release "tips"
// (staged-vs-live) and the post-release revision redline (oldRev-vs-newRev).
// -----------------------------------------------------------------------------
export type MethodDiffStatus = "added" | "removed" | "modified" | "unchanged";

export type MethodDiffEntry<T> = {
  status: MethodDiffStatus;
  before: T | null;
  after: T | null;
  // Field-level changes for a "modified" entry: { field: { before, after } }.
  changedFields?: Record<string, { before: unknown; after: unknown }>;
};

// One operation's child-level diff (steps / parameters / tools), each bucket
// classified added/removed/modified/unchanged. Defined here (not in
// changeOrder.diff.ts) so ChangeOrderItemDiff can carry the operation tree
// without a circular import; changeOrder.diff.ts re-exports these for its own
// callers.
export type OperationChildrenDiff = {
  steps: MethodDiffEntry<Record<string, unknown>>[];
  parameters: MethodDiffEntry<Record<string, unknown>>[];
  tools: MethodDiffEntry<Record<string, unknown>>[];
};

// An operation diff entry, optionally carrying its child-level diff. A superset
// of MethodDiffEntry, so consumers typed against the base entry keep working.
export type OperationDiffEntry = MethodDiffEntry<Record<string, unknown>> & {
  children?: OperationChildrenDiff;
};

export type ChangeOrderItemDiff = {
  affectedItemId: string;
  itemId: string;
  materials: MethodDiffEntry<Record<string, unknown>>[];
  // Operations carry the optional child (steps/parameters/tools) diff so the
  // read-only diff viewer can render the BOP as a tree.
  operations: OperationDiffEntry[];
  attributes: MethodDiffEntry<Record<string, unknown>>[];
};

// -----------------------------------------------------------------------------
// Change Order Types (the "Category" lookup — configured like Issue Types)
// -----------------------------------------------------------------------------
export const changeOrderTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" })
});
