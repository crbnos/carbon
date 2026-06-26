// Shared types for the Implementation Hub. App-agnostic: no Supabase/React
// Router imports here so the content templates + pure logic stay portable.

// The seven functional areas == Carbon's real modules (see RESTRUCTURE_SPEC).
export type Mod = "sal" | "pur" | "inv" | "itm" | "prd" | "qms" | "acc";

export const MODULES: readonly Mod[] = [
  "sal",
  "pur",
  "inv",
  "itm",
  "prd",
  "qms",
  "acc"
];

export const MODULE_NAME: Record<Mod, string> = {
  sal: "Sales",
  pur: "Purchasing",
  inv: "Inventory",
  itm: "Items",
  prd: "Production",
  qms: "Quality",
  acc: "Accounting"
};

export type Owner = "carbon" | "you" | "shared";
export type Tier = "self_serve" | "guided" | "enterprise";
export type HubStatus =
  | "tailoring"
  | "shared"
  | "active"
  | "complete"
  | "archived";
// Sidebar groups, ordered to mirror the customer's journey: orient → agree on
// the work → plan it → configure Carbon → train + launch → (internal tools).
export type PageGroup =
  | "get-started"
  | "align"
  | "plan"
  | "configure"
  | "launch"
  | "carbon-only";

// Kinds persisted in implementationCheckState.kind.
export type StateKind =
  | "gate"
  | "task"
  | "check"
  | "scopeFlag"
  | "productStep"
  | "fmt";

export type GateValue = "todo" | "prog" | "done";
export type TaskValue = "todo" | "prog" | "blocked" | "done";

// The signal a nested product step auto-detects against. `null` => manual only
// (e.g. "run MRP" has no cheap persisted signal).
export type DetectSignal =
  | "hasItems"
  | "hasMakeMethod"
  | "hasJob"
  | "hasSalesOrder"
  | "hasTrackedEntity";
export type Detect = DetectSignal | null;

// A product "do-this-in-Carbon" action nested inside a services step.
export interface NestedProductStep {
  key: string; // stable, e.g. "prod:import-bom"
  label: string;
  detail?: string;
  docsUrl?: string;
  videoKey?: string; // resolved against the ERP trainingConfig
  // CTA label on the "Next step" card. Defaults to "Open in Carbon"; override
  // when the step opens a hub page rather than an app screen.
  cta?: string;
  detect: Detect;
  // Tiers this step applies to. Omitted => all tiers. Self-serve customers
  // don't do net-new work or stand up their own hosting, so those steps are
  // scoped to the paid tiers and never count toward a self-serve gate.
  tiers?: Tier[];
}

// Geometry for a step's bar on the "Timeline at a glance" Gantt. The gate marker
// sits at the bar's right edge; `color` is the gate's swatch.
export interface GanttBar {
  color: string;
  // Template geometry in WEEKS from project start. The default dates derive from
  // these + the per-company `plan.startDate`; a per-gate date override then
  // recomputes the bar (see logic/timeline.ts). `startWeek` 0 = project start.
  startWeek: number;
  weeks: number;
}

export interface StepDef {
  key: string; // stable, e.g. "gate:discovery"
  n: number; // 1-based position; renumbered per tier by spineForTier
  title: string;
  gate: string; // "Scope signed"
  owner: Owner;
  timing: string;
  refSlug: string; // page slug the gate references
  desc?: string;
  nested?: NestedProductStep[];
  gantt?: GanttBar; // bar position on the timeline gantt
  // Tiers this gate applies to. Omitted => all tiers. e.g. the Acceptance gate
  // is paid-only — self-serve has no formal sign-off step.
  tiers?: Tier[];
}

// A hub page (sidebar entry + content surface).
export interface PageDef {
  slug: string; // matches the route filename, e.g. "how-we-work"
  navLabel: string;
  title: string;
  group: PageGroup;
  order: number;
  optional?: boolean; // excludable whole page (e.g. Value Snapshot)
  carbonOnly?: boolean; // never shown to customers
  // Tiers this page applies to. Omitted => all tiers. e.g. Data Migration is
  // paid-tier only and is hidden for self-serve.
  tiers?: Tier[];
  key?: boolean; // "most important" marker
  moduleTags?: Mod[];
  trainingKey?: string;
  docsUrl?: string;
}

// A fill-in field; ownership drives who may write it (enforced server-side).
export interface FieldDef {
  key: string; // stable, e.g. "scope.goal"
  label: string;
  ownership: Owner;
  dataType: "text" | "date" | "money" | "number" | "email";
  defaultValue: string;
}

// Per-company hub config (implementationHub.exclusions + contacts JSONB).
export interface HubExclusions {
  modules: Mod[];
  pages: string[];
  sections: string[];
}

export interface HubContacts {
  pocUserId?: string;
  owner?: string;
  champion?: string;
}

// Minimal shape of a persisted toggle row — kept here so the pure logic does
// not depend on the generated Supabase types.
export interface CheckStateRow {
  itemKey: string;
  kind: StateKind;
  value: string;
}

// A per-company fill-in override (implementationFieldValue).
export interface FieldValueRow {
  fieldKey: string;
  value: string;
}

// A per-company custom row (implementationRow) — staff-added tasks/risks/etc.
export interface ImplementationRowData {
  id: string;
  collection: string;
  payload: Record<string, unknown>;
  sortOrder: number;
}

// Payload shape for a custom Board task.
export interface CustomTaskPayload {
  label: string;
  owner: Owner;
  status: TaskValue;
}

// Payload shape for a custom Data Migration / Setup row. "validated" /
// "configured" is tracked separately as a scopeFlag keyed by the row id (like the
// template rows). `url` is an optional deep link — Setup rows can point at a
// screen the way template rows do.
export interface CustomDataPayload {
  object: string;
  today: string;
  url?: string;
}

// Payload shape for a custom Requirements row. "in scope" is tracked separately
// as a scopeFlag keyed by the row id (like the template requirements).
export interface CustomRequirementPayload {
  requirement: string;
}

// Payload shape for a custom Go-Live cutover step. "done" is tracked separately
// as a check keyed by the row id (like the template cutover steps).
export interface CustomGoLivePayload {
  label: string;
}

// A Project Board task. Grouped under a spine step; its completion is the
// shared source of truth that the Plan page's checklist derives from (toggling
// in either place updates the same `task` check state — no drift).
export interface BoardTask {
  key: string; // stable board key (taskKey(key) => itemKey)
  label: string;
  stepKey: string; // a SPINE step key, e.g. "gate:configure"
  owner: Owner;
  // Tiers this task applies to. Omitted => all tiers. e.g. hypercare is paid-tier
  // only — self-serve has no Carbon team providing post-launch support.
  tiers?: Tier[];
}
