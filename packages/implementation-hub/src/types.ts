// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Shared types for the Implementation Hub. App-agnostic: no Supabase/React
// Router imports here so the content templates + pure logic stay portable.

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { OnboardingCountKey } from "./logic/status";

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

export const MODULE_NAME: Record<Mod, MessageDescriptor> = {
  sal: msg`Sales`,
  pur: msg`Purchasing`,
  inv: msg`Inventory`,
  itm: msg`Items`,
  prd: msg`Production`,
  qms: msg`Quality`,
  acc: msg`Accounting`
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
  label: MessageDescriptor;
  detail?: MessageDescriptor;
  docsUrl?: string;
  videoKey?: string; // resolved against the ERP trainingConfig
  // CTA label on the "Next step" card. Defaults to "Open in Carbon"; override
  // when the step opens a hub page rather than an app screen.
  cta?: MessageDescriptor;
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
  title: MessageDescriptor;
  gate: MessageDescriptor; // "Scope signed"
  owner: Owner;
  timing: MessageDescriptor;
  refSlug: string; // page slug the gate references
  desc?: MessageDescriptor;
  nested?: NestedProductStep[];
  gantt?: GanttBar; // bar position on the timeline gantt
  // Tiers this gate applies to. Omitted => all tiers. e.g. the Acceptance gate
  // is paid-only — self-serve has no formal sign-off step.
  tiers?: Tier[];
}

// A hub page (sidebar entry + content surface).
export interface PageDef {
  slug: string; // matches the route filename, e.g. "how-we-work"
  navLabel: MessageDescriptor;
  title: MessageDescriptor;
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
  label: MessageDescriptor;
  ownership: Owner;
  dataType: "text" | "date" | "money" | "number" | "email";
  // DB-stored default written/read as a plain string — NOT translated. (Content
  // defaults that flow through EditableField's `defaultValue` prop are a separate
  // concern and DO become MessageDescriptor; this interface field is not one.)
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

// Who wrote a tick or a row (implementationSource). Ticks use the first three.
export type Source = "customer" | "staff" | "mcp" | "handover" | "interview";

// Minimal shape of a persisted toggle row — kept here so the pure logic does
// not depend on the generated Supabase types. The provenance fields are null
// on rows written before ticks recorded them.
export interface CheckStateRow {
  itemKey: string;
  kind: StateKind;
  value: string;
  source?: Source | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
  verifiedAt?: string | null;
  verifiedBy?: string | null;
}

// One assignee per hub item (implementationAssignment). `itemKey` is the
// item's status key: task:<key>, flag:setup.<key or row id>, or row:<row id>.
export interface AssignmentRow {
  itemKey: string;
  assigneeId: string;
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
  // Where the row came from, and a reference to its evidence (a link, a
  // document name, the handover question). Null on rows written before v2.
  source?: Source | null;
  sourceRef?: string | null;
}

// Payload shapes for custom (staff-added) rows. These fields are DB-stored,
// user-editable row DATA — read back from the persisted payload as plain strings
// and round-tripped via updateRow — so they stay `string` and are never
// translated (same rule as collections.ts `newPayload()` seeds).

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

// A company site, for tagging an objective by location.
export interface HubLocation {
  id: string;
  name: string;
}

// A person who can be assigned hub work: an employee of the company.
export interface HubPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
}

// A detectable business event an objective can be tied to. Each one reads a
// setup count (see content/objectives.ts), shown as the objective's evidence.
export type ObjectiveEvent =
  | "quoteSent"
  | "salesOrderConfirmed"
  | "purchaseOrderFinalized"
  | "receiptPosted"
  | "jobReleased"
  | "jobCompleted";

// Payload of an `objective` row: one record serves as a milestone (it has an
// event and a target date), an acceptance goal (`goLive`), and a personal
// objective (it has an assignee). Done is a manual tick, a `check` keyed by
// objectiveCheckKey(row id); the event's count is evidence only.
export interface ObjectivePayload {
  title: string;
  detail?: string;
  event?: ObjectiveEvent;
  targetDate?: string; // YYYY-MM-DD
  goLive?: boolean; // required for go-live (an acceptance goal)
  locationId?: string; // for a company with more than one site
}

// Payload of a `question` row: an open question from discovery, owned by its
// assignee until it is answered. A typed answer, or, when the row lists
// `options`, the chosen ones in `selected` (`multiple` allows several; "?" is
// Not sure). `readQuestion` (logic/question.ts) reads one safely.
export interface QuestionPayload {
  question: string;
  answer?: string;
  options?: string[];
  multiple?: boolean;
  selected?: string[];
}

export type CustomizationKind =
  | "configuration"
  | "customField"
  | "documentTemplate"
  | "integration"
  | "automation"
  | "report"
  | "code";

export type CustomizationStatus =
  | "proposed"
  | "agreed"
  | "inProgress"
  | "done"
  | "dropped";

// Payload of a `customization` row: one change Carbon makes for this customer,
// beyond standard setup. Carbon staff edit it; the customer reads it.
export interface CustomizationPayload {
  title: string;
  kind: CustomizationKind;
  status: CustomizationStatus;
  detail?: string;
  requirementRowId?: string; // the requirement row it serves
  targetDate?: string; // YYYY-MM-DD
  estimateDays?: number;
}

// When an operational task is ready to show: every listed setup count is at
// least its `min`. A count that could not be read is not ready.
export type ReadinessRule = { count: OnboardingCountKey; min: number }[];

// A Project Board task. Grouped under a spine step; its completion is the
// shared source of truth that the Plan page's checklist derives from (toggling
// in either place updates the same `task` check state — no drift).
export interface BoardTask {
  key: string; // stable board key (taskKey(key) => itemKey)
  label: MessageDescriptor;
  stepKey: string; // a SPINE step key, e.g. "gate:configure"
  owner: Owner;
  // Tiers this task applies to. Omitted => all tiers. e.g. hypercare is paid-tier
  // only — self-serve has no Carbon team providing post-launch support.
  tiers?: Tier[];
  // Setup Map row keys (content/setup.ts `SetupRow.key`) this task rolls up.
  // When set, the task auto-derives done/in-progress from those rows'
  // "configured" scopeFlags instead of needing its own manual tick — so Plan
  // and the Setup Map can never drift apart for the same work.
  setupKeys?: string[];
  // Learn links for the task, shown as Docs/Video badges on the Plan row. For
  // Configure's group tasks these come straight from the Setup Map group.
  docsUrl?: string;
  academyUrl?: string;
  // Optional one-line description shown under the task label on the Plan row.
  hint?: MessageDescriptor;
  // Operational tasks (content/operational.ts): the task shows only once the
  // records it needs exist, and shows the count of the documents it creates.
  // The count is evidence; the task is still ticked by hand.
  ready?: ReadinessRule;
  evidence?: OnboardingCountKey;
}
