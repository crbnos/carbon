# Change Notice Operational Impact Assessment

> Status: in progress (supported Impact backend slices 1–3, read-only Slice 4 workspace, and Slice 5D search/filtering implemented; Slice 5E/6 pending)
> Author: Coding agent with the Carbon discovery investigation
> Date: 2026-08-24
> Baseline: `refs/remotes/upstream/main` at `5089ee75ee332ef22d74ebd8e230f4bbfb0c9221`
> Research: Prior read-only Carbon investigation in this session. No new research pass was performed.
>
> **Current implementation note:** The current Slice 4 workspace exposes supported
> Purchase Order line, producing Job, and Job Material assessment targets as a
> read-only surface. It does not load context-only where-used rows; it renders an
> informational deferral notice instead. The context-only section below remains
> approved product scope, not an implemented Slice 4 acceptance claim.

## TLDR

Change Notice Impact becomes a document-first operational workspace with durable,
per-target assessment decisions for Purchase Order lines, producing Jobs, and Job
Materials. Carbon discovers those targets in set-based queries, preserves the
affected Change Notice items that caused each target to appear, shows the current
operational facts needed for a first-pass decision, and records one independent
assessment per target. The V1 decision model is deliberately small: `No action
required`, `Action required`, and `Resolved`; `Unassessed`, `Changed since
assessment`, `Restricted`, `Historical reference`, and `Source deleted` are derived
conditions rather than persisted workflow states. Existing
Change Notice action tasks remain the follow-up mechanism, while a durable Impact
assessment history records meaningful reassessments independently of optional generic
audit logging. Only current operational exposure enters the assessment population;
historical references remain visible without becoming checkbox work. `Done` continues
to release and freeze the engineering definition,
but supported operational Impact decisions and follow-up tasks remain accessible and
editable after release.

## Part 1 - Product Specification

## Problem Statement

Carbon Change Notices currently start with affected engineering items and show a
read-only `getPartUsedIn()` where-used tree. The current detail loader invokes
`getPartUsedIn()` once for each affected item, and the helper performs 15 logical
source reads per item, with most direct reads capped at 100 rows. The result is useful
context, but it is not a durable operational assessment population:

- a Purchase Order header does not explain which line needs intervention;
- a Job that produces the changed item and a Job Material that consumes it are
  different operational consequences but currently appear as related where-used
  records;
- a user cannot record why a target was considered safe or what remains unresolved;
- a completed Change Notice action task does not prove that the operational
  consequence is closed;
- live source changes can make an earlier conclusion look current when it is not;
- permission-filtered or capped discovery can look like an empty, safe result;
- the current Change Notice lock makes action-task follow-up unavailable after
  `Done` even though `Done` is the engineering release point.

The current code confirms that `Implementation -> Done` calls `applyChangeNotice()`,
which activates the engineering drafts and performs the final compare-and-swap to
`Done`. `changeNoticeStatusTransitions` makes `Done` terminal, and
`requireEditableChangeNoticeRoute(... scope: "workflow")` currently prevents action
task edits after `Done`. That behavior is internally consistent for engineering
history, but it is not sufficient for an operational follow-up workflow.

### Concrete failure

```text
CN-104 changes PART-A to Rev B.
PO-104 Line 10 ordered 500, received 0.
PO-104 Line 20 ordered 100, received 100.
```

A PO-level decision would hide the difference between the two lines. A flat
where-used list gives the buyer no durable place to record that Line 10 needs a
supplier call while Line 20 needs no purchasing intervention.

### Another concrete failure

```text
CN-104 reaches Done.
Action task: Ask supplier whether Rev B production started.
Task status: Completed.
Supplier confirms 400 old-revision units are finished.
```

The task completed successfully, but the Impact is still unresolved. Carbon needs to
preserve that distinction instead of inferring resolution from task status.

## User Value

The feature serves a practical manufacturer workflow:

1. An engineering change owner sees which purchasing and production records are
   exposed.
2. A buyer or production planner sees enough current quantity, status, and date
   context to make a first-pass decision.
3. The user records a defensible conclusion without typing evidence Carbon already
   knows.
4. Real follow-up is routed through the existing Change Notice task system.
5. The user can tell whether the facts behind an earlier decision changed.
6. Engineering release does not strand operational work.

The feature communicates local certainty. A no-action decision for one PO line means
that no purchasing intervention is required for that line. It does not mean that
receiving, inventory, Quality, sales, or every other affected record is safe.

## Goals

- Replace the current assessment-blind where-used experience with a trustworthy
  operational Impact workspace.
- Present recognizable documents first, with independently assessable target rows.
- Persist one Impact Decision per supported operational target.
- Preserve the affected-item provenance cause for each target and its interval history when that cause changes over time.
- Support full assessment for PO lines, producing Jobs, and Job Materials only.
- Show receipt, inspection, sales, shipment, and other references as clearly labeled
  context-only information where useful.
- Record `No action required`, `Action required`, and explicit `Resolved` outcomes.
- Reuse `changeOrderActionTask` rather than creating an Impact-specific task system.
- Persist normalized decision evidence and detect material source changes.
- Guarantee meaningful reassessment history as feature data, independent of the
  optional generic audit pipeline.
- Keep engineering release behavior and operational follow-up behavior distinct.
- Make incomplete, restricted, source-deleted, and unavailable evidence visible.
- Support bulk assessment without collapsing independent target identities.

## Non-goals

- Generic PLM approval, sign-off, or risk-acceptance machinery.
- A Change Notice release gate requiring every Impact target to be green.
- Top-level `Not applicable` or `Accepted exposure` states.
- A second task system or per-decision copies of task status.
- Automatic edits to Purchase Orders, Jobs, Job Materials, inventory, receipts,
  shipments, or methods.
- Automatic material disposition or automatic NCR closure.
- Full inventory, lot, serial, receipt, inspection, sales, shipment, quote, or
  maintenance assessment in V1.
- Duplicating NCR/Quality, customer-acceptance, deviation, or use-as-is workflows.
- A universal open-ended polymorphic target registry.
- Exact stale notifications or background reconciliation for every tenant in V1.
- Renaming the existing Change Notice `Done` status in this feature.
- Broad competitor research or new manufacturer interviews before writing the spec.

## Target Users and Roles

| User | Primary job in this feature | Required capability |
|---|---|---|
| Engineering change owner | Understand downstream exposure and record initial decisions | Change Notice view plus operational-impact update capability and source read access |
| Buyer / purchasing user | Decide whether individual PO lines need supplier action | Change Notice view plus operational-impact update capability and `purchasing_view` |
| Production planner / supervisor | Decide whether producing Jobs or consuming materials need intervention | Change Notice view plus operational-impact update capability and production visibility |
| Quality user | See Quality and inspection context without duplicating Quality disposition | Change Notice view plus `quality_view` where details are shown |
| Read-only stakeholder | Review decisions, evidence, provenance, and history | Change Notice view plus source read access for unredacted context |

V1 defines a product capability named **Change Notice operational-impact update**.
The implementation may map it to the existing `parts_update` permission if that is
safe and usable for the relevant roles. That mapping is not a permanent product
requirement. Source-domain read capability remains mandatory.

## Terminology

| Term | Meaning |
|---|---|
| Change Notice | Carbon's engineering change record, currently implemented in the Items/Parts area |
| Affected Item | An engineering item selected by the Change Notice author |
| Impact relationship | Any current or historical where-used relationship discovered from an affected item |
| Current operational exposure | A relationship that satisfies the V1 domain eligibility rule and may receive a decision |
| Historical reference | A source relationship that remains useful context but does not require a current Impact decision |
| No longer in current scope | The source record still exists, but it no longer matches the current affected-item set |
| Source deleted | The source record itself no longer exists; this is not the same as leaving current scope |
| Impact target | The smallest V1 operational record that can receive one independent decision |
| Impact Decision | The persisted current conclusion for one Change Notice and one target |
| Cause / provenance | The affected-item relationship explaining why a target was discovered, with current and historical form |
| Assessment snapshot | A deterministic, target-type-specific set of decision-relevant facts captured at assessment time |
| No action required | The target was reviewed and requires no operational intervention for this Change Notice |
| Action required | The target has an operational consequence that remains unresolved or needs intervention |
| Resolved | An authorized user explicitly confirms that the required operational consequence is closed |
| Changed since assessment | The live decision-relevant facts differ from the stored assessment snapshot |
| Restricted | The current user cannot read the source evidence needed for a confident assessment |
| Unavailable | Carbon cannot establish current source facts because the source service failed or coverage is incomplete |
| Context-only | A relationship Carbon displays but does not allow a V1 Impact Decision on |

The UI should use `Changed since assessment` rather than exposing `Stale` as a
workflow state. `Stale` remains an implementation and reporting term for the derived
condition.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Presentation | Document-first workspace grouped by PO and Job | Users recognize operational documents more readily than a flat target-type list |
| Persistence identity | One decision per `(companyId, changeNoticeId, targetType, targetId)` | A PO line, Job, and Job Material can change independently |
| Producing Job target | Job-level decision in V1 | The first useful question is whether the Job can finish producing the changed item under the old revision |
| Consuming production target | Job Material | Issued, consumed, required, and remaining quantities are material-line facts |
| Affected-item relationship | Separate provenance intervals | Each V1 source target has at most one current affected-item cause; intervals preserve prior causes when the scalar source item changes or is removed |
| V1 full domains | PO lines, producing Jobs, Job Materials | These form the smallest coherent purchasing and production workflow |
| Exposure eligibility | Only current operational exposure enters the assessable section; historical relationships remain context | Prevents every historical where-used row from becoming a checkbox |
| Receipt boundary | Context-only until a trustworthy lot/inspection target exists | Receipt-line conclusions can conceal lot, serial, hold, quarantine, or inspection divergence |
| Decision states | `No action required`, `Action required`, `Resolved` | A single state axis prevents invalid conclusion/resolution combinations |
| Derived conditions | `Unassessed`, `Changed since assessment`, `Restricted`, `Historical reference`, `No longer in current scope`, `Source deleted`, `Unavailable` | These describe persistence, eligibility, evidence, and coverage, not the user's conclusion |
| No Action state taxonomy | Small structured reason set; conditional written rationale | Carbon's facts can be evidence, so routine self-evident outcomes should not require redundant prose |
| Not Applicable | Removed | When authoritative proof exists, effectivity and candidate false positives are No Action reasons, not a separate conclusion |
| Accepted Exposure | Removed | Quality, customer, deviation, and residual-risk workflows own those meanings |
| Task integration | Existing Change Notice action tasks, with an explicit operational-follow-up origin and many-to-many decision links | Linking a task does not change its post-Done editability; task execution is not consequence resolution |
| History | Guaranteed feature-owned append-only reassessment history | Generic audit is configurable, asynchronous, and retention-limited |
| Done behavior | Engineering definition freezes; Impact decisions and operational tasks continue | Release should not strand genuine downstream work |
| Cancelled behavior | Stop new scope and assessment while Cancelled, but allow existing Impact follow-up to be completed or closed when explicitly designated operational | Cancellation stops engineering scope without stranding cleanup work |
| Release gate | No Impact completeness gate in V1 | Candidate coverage can be partial and task completion does not equal closure |
| Source mutation | Never from Impact | PO, production, inventory, receipt, and Quality workflows remain authoritative |
| Multi-tenancy heuristic | New tables use `companyId`, composite primary keys, Carbon IDs, audit columns, and RLS | Carbon database convention |
| Service shape heuristic | Supabase services take client first and return `{data, error}`; multi-row writes use a Kysely transaction | Carbon database access convention |
| RLS heuristic | V1 may map decision reads/writes to the `parts` permission domain; source RLS remains domain-specific and service redaction is required | Change Notices live in Items/Parts, but source data must remain protected |
| Permission heuristic | Product requires operational-impact update plus source read; V1 may map update to `parts_update`, but does not make broad engineering permission the product contract | Assessment needs evidence, not source mutation |
| Form heuristic | Decision and bulk forms use `ValidatedForm` and existing Carbon validators; inline row actions may use fetchers | Matches Carbon form conventions |
| Module layout heuristic | Change Notice logic remains in `items.models.ts`, `items.service.ts`, `items.server.ts`, and Items UI; no `impact.*` module | Existing Change Notice architecture is inside Items |
| Backward compatibility heuristic | Existing ImpactPanel remains a summary entry point; engineering lock behavior remains for engineering fields; current parent-deletion semantics remain | The new workspace adds capability without inventing permanent parent retention |

## Information Architecture

### Existing Change Notice surfaces

The current properties-panel `ImpactPanel` remains a compact summary and entry point.
It may show supported assessment counts and a link to the full workspace, but it
must not pretend that its existing where-used tree is a complete assessment.

The existing Change Notice overview continues to contain engineering narrative,
authoring diff, and action tasks. Engineering authoring remains governed by the
current engineering lock.

### New Operational Impact workspace

The workspace should be a route-addressed full-page or content workspace under the
existing Change Notice route tree, using Carbon's standard detail-page conventions.
The proposed route is:

```text
/x/items/change-notice/{changeNoticeId}/impact
```

The exact route filename is an implementation choice, but it must remain under the
existing Change Notice route tree and use the typed `path.to.*` helpers.

The workspace contains:

1. **Header context**
   - Change Notice readable ID and name.
   - Engineering status badge.
   - Separate copy such as `Done · Engineering released` when applicable.
   - Assessment coverage warning when supported discovery is incomplete.

2. **Current operational exposure section**
   - Purchase Orders grouped by PO, with one row per eligible PO line.
   - Jobs grouped by Job, with eligible producing-Job and Job Material rows clearly
     distinct.
   - Filters for domain, decision status, changed-since-assessment, assignee/task,
     and text search.
   - Summary counts limited to eligible supported exposure.

3. **Historical references section**
   - Source records that still relate to affected items but no longer meet the V1
     current-exposure rule.
   - Prior decisions, history, current/historical provenance, and task links remain
     understandable.
   - No new `Unassessed` obligation is created merely because a historical reference
     is discovered.

4. **Context-only section (approved scope; deferred from current Slice 4)**
   - Receipts, inspections, sales orders, shipments, assembly instructions, and
     other useful references.
   - A visible `Informational context only` label.
   - No Impact decision buttons or green assessment counts.

5. **Target row context**
   - Enough current operational facts for a first-pass decision.
   - Link to the source record for deeper work.
   - Cause/provenance control showing the current affected item and any historical causes that led to discovery.
   - Existing authorized linked task names and statuses, without copying task status
     into the decision state.
   - `Changed since assessment`, `Restricted`, `Historical reference`, `No longer
     in current scope`, `Source deleted`, or `Unavailable` indicators where applicable.

6. **Decision controls**
   - `No action required` with structured reason.
   - `Action required` with create/link task actions.
   - `Resolve` for open Action Required decisions.
   - `Resolve` directly from a current-exposure New / Unassessed target when
     intervention already happened.
   - `Reassess` for all eligible persisted decisions.
   - No new conclusion or reassessment controls on Historical references, No longer
     in current scope, Source deleted, Restricted rows, or unavailable source rows;
     an existing Action Required row may retain an explicit Resolve action for work
     already in progress.

7. **History panel**
   - Current assessment evidence.
   - Chronological meaningful assessment events.
   - Prior conclusion, reason, snapshot summary, actor, and timestamp.
   - Clear distinction between `Action required -> Resolved` and
     `Action required -> No action required`.

The current right-side properties panel should not become a miniature full record
page. The workspace provides the workflow; the source-record link provides depth.

## Assessable Exposure vs Historical Reference

A where-used relationship is not automatically an assessment obligation. Carbon
first classifies each supported relationship using the current source facts:

```text
Impact relationship
    ↓
Current operational exposure?
    ├── yes → Current operational exposure / assessable
    └── no  → Historical reference / informational
```

`Current operational exposure` is an eligibility classification, not a conclusion.
An eligible target may still receive No Action, Action Required, or Resolved. A
Historical reference does not create a New / Unassessed decision obligation.

### Purchase Order line eligibility

A PO line is current assessable exposure when all of the following are true:

- the line still matches at least one current affected Change Notice item;
- the line retains an open purchasing/receiving commitment, represented in V1 by
  `receivedComplete = false` and a positive normalized remaining quantity;
- the parent PO is not terminal or cancelled.

A line with zero remaining quantity, `receivedComplete = true`, or a terminal parent
PO is a Historical reference by default. This is deliberately not a No Action
conclusion. Carbon does not currently have enough PO-line semantics to infer that a
supplier return, replacement coordination, credit, or supplier communication is
unnecessary. Those consequences belong to the owning supplier, Quality, receipt, or
inventory workflows unless a separate current purchasing commitment exists.

A PO line with an open commitment remains assessable even if the user expects no
intervention. If the user needs to record that no purchasing intervention remains,
the domain-specific No Action reason and rationale rules below apply.

### Producing Job eligibility

A producing Job is current assessable exposure when:

- `job.itemId` still matches a current affected Change Notice item; and
- Job status is operationally active: `Draft`, `Planned`, `Ready`, `In Progress`, or
  `Paused` in the current Carbon lifecycle.

`Completed`, `Closed`, and `Cancelled` Jobs are Historical references for the Job
assessment domain. Their downstream inventory, Quality, shipment, and traceability
consequences may remain visible as context, but the Job itself does not create a
new assessment checkbox.

### Job Material eligibility

A Job Material is current assessable exposure when:

- its material item still matches a current affected Change Notice item; and
- its parent Job is operationally active under the producing-Job rule.

Issued or fully consumed quantity does **not** remove an active Job Material from
assessment. It may represent material already in WIP, so issued/consumed quantity is
context and freshness evidence rather than an eligibility shortcut. A Job Material
under a terminal parent Job becomes a Historical reference; downstream physical or
Quality consequences remain context-only in V1.

### Eligibility changes

Eligibility is re-evaluated during complete discovery and explicit refresh:

- a current exposure can move to Historical reference when its domain rule stops
  being true;
- a Historical reference can return to current exposure if its source becomes
  eligible again;
- no transition automatically changes the stored decision to No Action or Resolved;
- a prior decision and its task links remain visible in Historical references;
- an existing Action Required decision may still be explicitly resolved when its
  already-required work is closed, but no new No Action conclusion or reassessment
  is created for a Historical reference;
- if a target returns to current exposure, its prior decision is shown with any
  Changed since assessment condition and requires deliberate reassessment.

## Supported V1 Domains

### Full assessment

#### Purchase Order lines

Presentation is grouped by Purchase Order. Each eligible current-exposure
`purchaseOrderLine` receives its own decision. A completed, short-closed, or
terminal line remains available under Historical references rather than becoming a
new assessment checkbox.

A line's context should include, where present in current Carbon models:

- Purchase Order readable ID and status;
- supplier;
- affected item and affected revision;
- ordered quantity;
- received quantity;
- remaining quantity;
- `receivedComplete` / short-close indication;
- requested or promised date;
- purchase and inventory UOM context;
- conversion factor and normalized inventory quantity where relevant;
- affected Change Notice item provenance.

A PO-level status is a grouping and rollup only. It never substitutes for line
assessment.

#### Producing Jobs

A Job whose `job.itemId` is an affected engineering item receives one Job-level
decision only while it meets the current operational-exposure rule. Terminal Jobs
remain Historical references for this assessment domain.

Context should include:

- Job readable ID and status;
- produced item and revision;
- planned quantity;
- completed quantity;
- remaining quantity;
- shipped or received quantity where it changes the consequence;
- due date;
- current method/version identity where available;
- location and source links where available.

The producing-job decision answers whether the Job's output can finish under the
changed engineering definition. It does not decide every operation independently.

#### Job Materials

A `jobMaterial` whose item is an affected engineering item receives one decision
while its parent Job remains operationally active. Issued or consumed quantity does
not by itself move an active Job Material into history.

Context should include:

- parent Job readable ID and status;
- affected material item;
- required quantity;
- issued/consumed quantity where reliably available;
- remaining exposure;
- method type;
- operation relationship where useful;
- tracking requirement where useful.

A Job can therefore have both a producing-job decision and one or more consuming
material decisions. They are intentionally independent.

### Context-only domains

The discovery/read model may continue to expose these references:

- Receipts and receipt lines;
- Inspections and Quality records;
- Sales Orders and sales-order lines;
- Shipments and shipment lines;
- Assembly Instructions;
- Quotes and supplier quotes;
- Maintenance references;
- Other current where-used categories that help a user find the owning workflow.

Each context group must be labeled `Informational context only`. It must not appear
in the supported assessment totals or offer Impact decision buttons.

### Not Impact targets in V1

- **NCRs / Issues:** link and surface the Quality-owned workflow. Do not create an
  Impact Action Required state for the NCR itself.
- **Methods:** these are part of the engineering Change Notice authoring and release
  scope. Do not duplicate engineering decisions as operational Impact rows.
- **Inventory lots, serials, tracked entities:** show relevant context where useful,
  but defer full assessment until a physical/quality target contract exists.

## Target Identity and Provenance

### Target identity

The product identity is:

```text
(companyId, changeNoticeId, targetType, targetId)
```

V1 `targetType` values are:

```text
purchaseOrderLine
job
jobMaterial
```

`targetId` is the source record ID. There is no parent-document decision row and no
V1 `targetSubId`.

Each V1 source target has one scalar source-item reference:
`purchaseOrderLine.itemId`, `job.itemId`, or `jobMaterial.itemId`. Because
`changeOrderAffectedItem` is unique on `(changeOrderId, itemId)`, a target has at
most one current affected-item cause at a time. It still gets one decision, while
separate provenance intervals preserve causes over time:

```text
CN-50
  PART-A (current affected item)

PO-104 Line 10
  one Impact Decision
  current provenance: PART-A

The line later changes from PART-A to PART-B, while both remain in CN-50:
  PART-A interval ends
  PART-B interval starts
  one Impact Decision remains
```

A target cannot reference PART-A and PART-B simultaneously through any of the
three V1 source rows. If the consequence differs by child record, Carbon must use
the finer target. For example, different Job Material lines receive separate
decisions instead of a Job parent decision with child overrides.

### Provenance

Every current exposure or Historical reference must preserve its current affected
item cause when one exists, plus any historical causes that remain traceable. For
the three V1 source target types, the current cause is at most one item because
`purchaseOrderLine.itemId`, `job.itemId`, and `jobMaterial.itemId` are each one
scalar source reference and `changeOrderAffectedItem` is unique on
`(changeOrderId, itemId)`; historical provenance may contain several ended
intervals. The workspace should provide a compact provenance
popover or expandable row:

```text
Current provenance:
PART-A Rev A

Historical provenance:
PART-B Rev C (removed from Change Notice before release)
```

Provenance is not a second conclusion and does not create duplicate decisions.

### Current and historical provenance

A provenance relationship is current only while the affected item remains in the
Change Notice's current scope and the source target still matches that item. When an
affected item is removed, or a source row changes so it no longer matches the current
affected-item set, Carbon ends the current provenance relationship and preserves it
as historical provenance. The three V1 source rows each carry one scalar `itemId`,
so there is no simultaneous second current cause. If a source row changes from
PART-A to PART-B and PART-B is in the current scope, the PART-A interval ends and a
new PART-B interval starts; those are successive causes, not simultaneous ones.

Ending provenance does not delete the decision, resolve it, or mark it No Action. It
moves the target out of Current operational exposure when its one current provenance
cause is gone and keeps its prior decisions, history, and task links under Historical
references.

### Bulk identity

Bulk actions create or update one row per target. A shared reason or note is copied
as input, not persisted as a shared decision. Each target retains its own snapshot,
provenance, status, and history.

## Assessment State Machine

### Derived Unassessed

`Unassessed` means no deliberate persistent Impact Decision exists. Carbon must not
insert an `Unassessed` row.

A new supported target discovered while the Change Notice is open or after release
appears as `New / Unassessed` until the user records a decision.

### Persistent states

```text
No action required
Action required ──→ Resolved

Unassessed ───────→ Resolved
(intervention already complete)
```

### Allowed transitions

| From | To | Meaning |
|---|---|---|
| No row | No action required | User reviewed the target and no intervention is needed |
| No row | Action required | User reviewed the target and identified unresolved intervention |
| No row | Resolved | A current operational-exposure target had intervention completed before Carbon recorded the first assessment; closure evidence is mandatory |
| No action required | Action required | Reassessment found a real unresolved consequence |
| Action required | No action required | Original assessment was wrong; no intervention was needed |
| Action required | Resolved | Intervention happened and the consequence is now closed |
| Action required | Action required | Rationale, context, task links, or evidence updated without closure |
| Resolved | Action required | New exposure appeared or the prior closure was invalidated |
| Resolved | No action required | Explicit correction that intervention was never required; mandatory correction rationale |
| Any persistent state | Same state | Non-conclusion edits that preserve the current meaning |

### Server-derived operation classification

The public mutation request does not select a `createDecision`,
`reassessDecision`, `correctDecision`, or `resolveActionRequired` operation enum.
It supplies the target identity, requested conclusion/reason or resolution
payload, and expected decision revision. The server loads the existing decision
and derives the internal operation and history event type from that state and the
requested conclusion. For example:

```text
no row + Action required       -> creation
No action required + Action required -> reassessment
Action required + No action required -> correction
Resolved + Action required     -> reopening
```

A first `Resolved` conclusion, a same-state evidence update, and a no-op are
similarly classified from the persisted row and request. The caller cannot choose
a history event type or bypass the state-specific validation by naming an
operation.

The UI should make the three meaningful outcomes visibly different:

```text
No action required
No intervention was necessary for this target.

Action required -> No action required
The original conclusion was wrong; intervention was never needed.

Action required -> Resolved
Required intervention occurred and closed the consequence.

Current operational exposure / New / Unassessed -> Resolved
Required intervention already occurred before Carbon recorded the assessment.
```

### Derived exposure and evidence conditions

These are classifications or coverage values, not state transitions:

```text
Current operational exposure
Historical reference
No longer in current scope
Source deleted
Changed since assessment
Restricted
Unavailable
```

A target can therefore display:

```text
Action required
Changed since assessment
```

without creating an invalid combined workflow state.

## Exact No Action Semantics

`No action required` means:

> The user reviewed this specific operational target against the available current
evidence and concluded that no operational intervention is required for this target
because of this Change Notice.

Examples:

```text
PO-104 Line 10
Current exposure: open supplier commitment
No action required
Reason: No purchasing intervention remains
Rationale: Supplier return, replacement, credit, and communication actions were reviewed and none remain for this line.
```

This means no purchasing intervention is required for that PO line. It does not
mean that a receipt, inventory lot, Job, or Quality workflow is safe. A completed or
short-closed PO line with no remaining quantity is normally a Historical reference,
not an automatic No Action decision.

### Initial reason codes

Reasons are domain-specific and intentionally small:

```text
Outside effectivity
Not affected after review
No purchasing intervention remains
```

Rules:

- `Outside effectivity` is conditionally supported. It is available only when the
  current Carbon implementation can derive a complete, authoritative,
  decision-relevant applicability proof from trusted server-side data. Until that
  proof exists for the target, the reason is unavailable. A client-supplied
  `effectivityProof` is never authoritative; V1 does not create an effectivity
  evidence subsystem or persist arbitrary proof JSON. If Carbon has no such proof
  provider yet, this one No Action reason is unavailable; the other decision paths
  remain implementable.
- `Not affected after review` is available for a discovered current exposure whose
  operational consequence was disproved; written rationale is always required.
- `No purchasing intervention remains` is available only for a PO-line exposure and
  requires one explicit user attestation, such as
  `confirmNoPurchasingInterventionRemains: true`, that supplier return,
  replacement, credit, and communication work do not remain, plus written
  rationale. The UI must state exactly what the attestation covers. Separate
  boolean fields for each reviewed action are not part of the contract unless a
  concrete Carbon source workflow later requires them. The existing Slice 1 pure
  validator may accept richer test/input objects, but that helper is not a client-
  authoritative mutation contract. Zero remaining quantity alone does not satisfy
  this reason.
- `Completed before cut-in` is a useful explanation for Historical reference
  classification, not an automatic No Action reason in V1.
- `No remaining open quantity` is evidence used for eligibility classification, not
  a conclusion that purchasing action is unnecessary.

`Already handled elsewhere` is intentionally not a No Action reason. If someone
performed an intervention outside Carbon, the correct history is normally:

```text
Action required -> Resolved
```

with a closure note describing what happened. This preserves the difference between
"no intervention was needed" and "intervention happened outside Carbon".

### Evidence and rationale rules

The structured reason and Carbon's current operational facts are evidence. Users do
not need to type prose that simply repeats visible facts, but a reason must never
hide a missing supplier or production decision.

| Situation | Reason | Written rationale |
|---|---|---|
| Outside effectivity with a complete, visible applicability proof | Outside effectivity | Optional if proof is unambiguous; otherwise required |
| Candidate current exposure disproved by review | Not affected after review | Required |
| PO-line user confirms no purchasing intervention remains | No purchasing intervention remains | Required |
| Any ambiguous judgment or override of discovery | Domain-appropriate reason | Required |
| Any reassessment that changes status or conclusion | Domain-appropriate reason | Required |
| Bulk routine No Action with deterministic evidence | Same valid domain reason | Shared note optional only where evidence is complete |
| Bulk selection containing ambiguous rows | Same valid domain reason | Per-row rationale required or row excluded |

Historical references do not offer No Action controls. If a user discovers a
remaining supplier, production, inventory, or Quality consequence, the owning
workflow or a genuinely eligible Impact target must carry it.

If a target is `Restricted`, `No longer in current scope`, `Source deleted`, or
`Unavailable`, Carbon must not allow No Action.

## Action Required Semantics

`Action required` means operational intervention is required or the consequence
remains unresolved.

The user can:

- create a new Change Notice action task;
- link an existing action task under the same Change Notice;
- link one task to several Impact Decisions when the work is genuinely shared;
- leave the decision open while the task executes;
- record a rationale without creating a task when work is owned outside Carbon;
- resolve directly when the required intervention already happened before assessment.

An open Action Required decision may exist without a linked task, but the UI should
show a `No task linked` warning and require a written rationale explaining the
follow-up path. The normal flow should offer task creation immediately.

The Impact workspace does not edit the underlying PO, Job, Job Material, Receipt, or
Quality record. The owning domain workflow remains authoritative.

## Resolved Semantics

`Resolved` means:

> An authorized user explicitly confirms that the operational consequence which
originally required intervention has been closed.

A first assessment may be recorded directly as Resolved for a current operational-
exposure target when the intervention happened before Carbon's first assessment. This
is truthful history, not a shortcut around the workflow:

```text
New / Unassessed
Buyer already contacted the supplier and completed the cut-in.
Resolved
```

Direct first-time resolution requires a closure note or equivalent evidence, actor,
time, and the current assessment snapshot. It does not require a fake intermediate
Action Required row.

When linked tasks exist:

- all linked tasks should be terminal before resolution;
- a completed or skipped task does not automatically resolve the Impact;
- the resolver must record a closure note or evidence summary;
- a skipped task is terminal for the prerequisite but is not proof of closure.

Resolution without a task is allowed when the work happened directly or outside
Carbon:

```text
PO-104 Line 10
Action required
Supplier was contacted outside Carbon; cut-in confirmed.
Resolved
```

Do not force users to create fake retroactive tasks.

## Reason, Rationale, and Evidence Rules

The current decision stores:

- decision status;
- No Action reason when applicable;
- optional or required written rationale according to the rules above;
- resolution note when Resolved;
- the normalized decision-relevant snapshot;
- assessor and assessment timestamp.

Evidence that Carbon already knows should be rendered from the current snapshot and
source context. A separate attachment subsystem is not required for V1. Existing
Change Notice, task, document, customer, and Quality links may be referenced when
available.

## Task Integration Semantics

The existing `changeOrderActionTask` remains the task entity. Impact adds a
many-to-many link between decisions and tasks; it does not copy task status into the
decision.

```text
Decision A ─┬─ Task T1: Ask supplier
Decision B ─┘

Task T1: Completed
Decision A: Action required
Decision B: Action required
```

One Impact Decision can link several tasks. One task can support several decisions.
The task has one Carbon task status, not one status per linked decision.

### Task origin and post-Done editability

Linkage does not determine task editability. Carbon must distinguish these task
origins with a durable origin/purpose marker on the existing task record:

```text
Template-owned
Manual
Impact follow-up
```

- `Template-owned` tasks originate from the Change Notice required-action/template
  workflow.
- `Manual` tasks are existing freeform tasks not designated as Impact follow-up.
- `Impact follow-up` tasks are created directly from the Impact workspace or are
  explicitly designated as Impact follow-up before the Change Notice reaches Done.

Rules:

- Creating a task from Impact always gives it `Impact follow-up` origin.
- Linking an ordinary Template-owned or Manual task does not change its origin.
- An authorized user may explicitly designate an existing task as Impact follow-up
  before Done, and that designation is itself recorded in history.
- After Done, an ordinary Template-owned or Manual task remains read-only. A link to
  an Impact Decision is not a backdoor around that lock.
- After Done, an Impact follow-up task may be edited through the operational Impact
  scope, including status, assignee, due date, notes, and completion.
- After Done, a user who needs new follow-up creates a new Impact-origin task rather
  than converting an ordinary locked task.
- The task origin marker is task-level. Linking the same Impact-origin task to
  several decisions does not create separate task statuses.

### Task content and source authorization

An existing Template-owned or Manual `changeOrderActionTask` remains governed by
Carbon's existing Change Notice task permissions. Linking it to an Impact Decision
does not reclassify, taint, or permanently restrict the task. A user who lacks the
source permission must not learn through the Impact workspace that the task is linked
to a restricted decision; the workspace hides the restricted decision/link metadata.
The same task may still appear in the ordinary Change Notice task UI when Carbon's
existing task permissions allow it. Linking or unlinking does not create a durable
cross-domain confidentiality ledger.

An Impact-created task remains a normal Carbon Change Notice action task. Its durable
Impact-follow-up origin controls lifecycle/editability after `Done`; origin is not a
generic confidentiality classification. Operational Impact must not automatically
copy restricted PO, Job, or Job Material fields into the task title, notes, or
external metadata merely to create the task. Prefer generic wording such as:

```text
Follow up on Change Notice operational impact
```

Users may still enter ordinary task content under Carbon's existing task model. This
feature does not retroactively secure arbitrary free-form text already stored in a
generic task or create a global content-classification engine.

Creating or linking a task does not resolve a decision. Completing a task does not
resolve a decision. An assessor explicitly resolves each affected decision after
verifying its consequence.

Task link and unlink actions are part of the feature history contract. They record
which task was connected or disconnected, the decision, actor, and time. Task status
history remains owned by the task workflow.

## Reassessment Behavior

### Original assessment was wrong

```text
Action required
Supplier investigation shows the supplier had already cancelled the order.
No action required
Reason: Not affected after review
Rationale: The supplier had cancelled before the original assessment; no intervention was required for this line.
```

The history must show that the Action Required conclusion was corrected. It must
not rewrite the event as if no prior assessment existed.

### Intervention solved the consequence

```text
Action required
Supplier contacted and remaining quantity moved to the new revision.
Resolved
```

This is not No Action. The history must preserve that intervention was required.

### Reopening a resolved decision

A resolved decision can be reassessed when a new exposure appears or the closure is
found invalid. The normal path is `Resolved -> Action required`. A direct
`Resolved -> No action required` correction is allowed only with a mandatory
correction rationale stating that intervention was never required.

## Operational Context and Decision-Relevant Snapshot

The workspace may display more context than it snapshots. Snapshot comparison is
canonical and deterministic per target type. Two `purchaseOrderLine` decisions use
the same `PO_LINE_SNAPSHOT_V1` structure; the user cannot choose fields based on the
particular conclusion.

Snapshot values use Carbon's canonical numeric and date representations. Display
names, avatars, formatted labels, and other cosmetic fields are never part of the
snapshot. IDs are included only where a change in identity can invalidate the
conclusion and are protected by the source-domain confidentiality rules.

### `PO_LINE_SNAPSHOT_V1`

```text
schema: PO_LINE_SNAPSHOT_V1
purchaseOrderLineId
purchaseOrderId
supplierId
itemId
itemRevision
purchaseOrderLineType
purchaseOrderStatus
receivedComplete
orderedQuantity
receivedQuantity
remainingQuantity
purchaseUnitOfMeasureCode
inventoryUnitOfMeasureCode
conversionFactor
requiredDate
promisedDate
eligibilityBasis
```

`eligibilityBasis` is the canonical value `openPurchasingCommitment` for an
assessable PO line. A zero remaining quantity is not itself a No Action conclusion;
it changes eligibility to Historical reference unless another supported current
purchasing commitment is represented by the source data.

### `JOB_SNAPSHOT_V1`

```text
schema: JOB_SNAPSHOT_V1
jobId
itemId
itemRevision
status
plannedQuantity
completedQuantity
remainingQuantity
quantityShipped
quantityReceivedToInventory
dueDate
effectiveMethodId
effectiveMethodVersion
unitOfMeasureCode
eligibilityBasis
```

`eligibilityBasis` is the canonical value `activeProducingJob`. Terminal Job status
moves the relationship to Historical reference rather than creating a No Action
assessment.

### `JOB_MATERIAL_SNAPSHOT_V1`

```text
schema: JOB_MATERIAL_SNAPSHOT_V1
jobMaterialId
jobId
itemId
itemRevision
jobStatus
requiredQuantity
issuedQuantity
remainingQuantity
unitOfMeasureCode
methodType
jobOperationId
requiresTracking
eligibilityBasis
```

`eligibilityBasis` is the canonical value `activeJobMaterial`. Issued or consumed
quantity remains in the snapshot because active WIP can still be affected even when
remaining quantity is zero.

Every canonical structure has the same keys for every decision of that target type.
A source value that is legitimately null remains explicit null; an unavailable
required value prevents confident assessment rather than being omitted from the
JSON. The implementation must verify the logical fields against the latest upstream
models and use Carbon's numeric precision conventions.

## Freshness Behavior

At assessment time Carbon stores a normalized decision-relevant snapshot.

Example:

```text
Assessed Aug 24
PO line: 0 / 500 received, 500 remaining
Decision: Action required
```

Later:

```text
Current
200 / 500 received, 300 remaining
```

The workspace shows:

```text
Changed since assessment
Assessed: 0 / 500 received
Current: 200 / 500 received
```

The old conclusion remains visible in history, but the current row must not look
unconditionally current.

### Freshness rules

- Compare current normalized facts with the stored snapshot when the workspace loads
  or the user explicitly refreshes.
- Use a stable snapshot schema version so future field-contract changes can be
  identified.
- A source `updatedAt` is useful context but is not the freshness authority.
- Do not require a stored hash in the product contract. A hash may be an implementation
  optimization after the snapshot comparison is correct.
- A changed source does not automatically choose a new operational conclusion.
- A stale No Action decision remains No Action plus `Changed since assessment` until
  the user reassesses it.
- A stale Resolved decision remains historically Resolved plus `Changed since
  assessment` until the user reopens or reassesses it.
- No V1 background job is required to write stale events for every source update.
  Staleness is evaluated when relevant data is read. The reassessment history records
  that the previous snapshot differed at the time of reassessment.

### Source and exposure conditions

The workspace keeps source availability separate from exposure eligibility:

```text
Exposure classification:
Current operational exposure
Historical reference
No longer in current scope

Source availability:
Present
Restricted
Source deleted
Unavailable
```

- `Current operational exposure`: the source exists, still matches current
  affected-item provenance, and satisfies the target-type eligibility rule.
- `Historical reference`: the source exists and is useful context, but its target
  type is no longer eligible for current assessment.
- `No longer in current scope`: the source exists, but it no longer matches any
  current affected Change Notice item.
- `Present`: current source can be read and normalized.
- `Restricted`: the user lacks source-domain read permission.
- `Source deleted`: the source record itself no longer exists, and the supported
  query had complete coverage. This is not a no-longer-in-scope result. A complete,
  authorized exact lookup may establish this condition, but it is source-
  availability evidence only.
- `Unavailable`: Carbon cannot establish current source facts because the source
  service failed or coverage is incomplete.

`Source deleted` is never `Resolved`. It must not automatically change a decision
or close an operational consequence. An existing `Action required` decision may
become `Resolved` only through an explicit authorized resolution with sufficient
closure evidence, even when the source is deleted.

## Live Discovery After Assessment

Supported discovery remains dynamic while the Change Notice is open and after
engineering release, but the active workspace surfaces **Current operational
exposure**, not every historical relationship.

If a new supported target appears and satisfies its domain eligibility rule, it is
shown as:

```text
Current operational exposure
New / Unassessed
```

A newly discovered Historical reference is shown only under Historical references;
it does not create a New / Unassessed obligation.

Carbon does not copy a decision from another target, parent document, or similar
line. If an existing target stops meeting the eligibility rule, it moves to
Historical references without any automatic state transition. If it no longer
matches the current affected-item set, it is explicitly marked No longer in current
scope. If the source row is gone, it is Source deleted.

A target that later becomes eligible again returns to Current operational exposure
with its prior decision, provenance history, and any Changed since assessment
condition. It requires deliberate reassessment if the decision-relevant facts differ.

Post-release discovery is read-time or explicit-refresh behavior in V1. It does not
create background monitoring jobs or notifications. While the parent Change Notice
exists, a refresh may continue to surface a target that satisfies the current
exposure rule; there is no arbitrary time cutoff. The eligibility rule prevents an
old Change Notice from turning every historical relationship into a new checkbox.
A new post-release current exposure can be assessed under the original Change Notice
without reopening or changing its engineering status. This is operational follow-up,
not a new engineering definition.

## Affected-item Scope Changes Before Release

The current affected-item set is the source of current provenance. It can change
while the Change Notice is still editable.

Example:

```text
CN-50 initially includes PART-A.
PO-104 Line 10 has an Action required decision.
PART-A is removed before Implementation.
```

Carbon must:

- preserve the existing decision and all assessment history;
- end the PART-A provenance link as historical, with an explicit reason such as
  `Affected item removed from Change Notice`;
- stop presenting the PO line as Current operational exposure when its one current
  affected-item cause is gone;
- show the target under Historical references / No longer in current scope;
- retain linked tasks and show that they relate to historical exposure;
- avoid automatically changing the decision to No Action or Resolved.

A V1 target cannot remain explained by a second affected item at the same time. If
its source row later changes from PART-A to PART-B and PART-B is in the current
scope, the PART-A interval ends and a new PART-B interval starts; the target remains
one decision with successive provenance. If PART-A is later added again, the new
affected-item relationship becomes current and the existing decision is shown with
its full prior history.

The current Change Notice engineering-scope mutation must reconcile provenance in a
focused transaction with the affected-item scope deletion and the Impact feature
data where possible. This does not require converting add/change-type draft
orchestration or best-effort draft cleanup into one large transaction. The future
implementation must also account for generic item deletion: the current
`changeOrderAffectedItem.itemId` foreign key is `ON DELETE CASCADE`, so deleting an
item can remove live source and affected-item rows without using the explicit
removal route. Persisted Impact decisions and historical identity remain preserved.
Before Slice 2 exits, generic deletion behavior must be handled consistently with
`Source deleted` and provenance semantics. Prefer reconciliation through the Impact
provenance/refresh machinery unless a synchronous guard is proven necessary by the
final implementation. Do not make generic Item deletion part of the Impact
transaction by default. Explicit affected-item removal remains the operation that
should synchronously end the current provenance interval because that mutation
directly changes Change Notice scope. A read-time label alone is not enough to
guarantee the promised history. A provenance-end event is feature history, not a
conclusion transition.

## History Behavior

### Product decision

V1 guarantees durable Impact reassessment history as feature data. Generic Carbon
audit remains supplementary.

A user must be able to understand a sequence such as:

```text
Aug 24
No action required
Snapshot: 0 / 500 received
Reason: Outside effectivity

Aug 26
Action required
Snapshot: 200 / 500 received
Reason: supplier intervention required

Aug 28
Resolved
Supplier confirmed cut-in and remaining old revision was controlled.
```

This guarantee must not depend on the company audit toggle, asynchronous queue
health, generic audit retention, or the viewer's settings permission.

### History events

A meaningful history row is written when a user or current-scope reconciliation:

- creates a decision;
- changes the decision status;
- changes the No Action reason;
- changes a conclusion during reassessment;
- records or changes a resolution note;
- records a materially different assessment snapshot;
- links a task to a decision;
- unlinks a task from a decision;
- starts or ends an affected-item provenance relationship.

A no-op save does not create a history row. Task status changes remain owned by the
task workflow and are not copied into Impact history.

Each history row stores, as applicable:

- actor and timestamp;
- event type;
- prior status and new status;
- prior reason and new reason;
- prior and new snapshot or a complete post-assessment snapshot;
- rationale or resolution note;
- related task ID for Task linked / Task unlinked events;
- related affected-item ID for provenance events;
- whether the prior snapshot was different at reassessment time;
- the Change Notice and target identity.

For a `Provenance ended` event, `changeOrderImpactDecisionAffectedItem.endedReason`
stores the structured end reason on the interval itself. The history row uses its
existing `rationale` field for the event's explanation and
`relatedAffectedItemId` to identify the historical affected-item relationship.
There is no separate `endedReason` column on `changeOrderImpactDecisionHistory`.

History rows are append-only by the Impact service contract while the parent Change
Notice exists. The current migration closes direct user INSERT/UPDATE/DELETE access;
it does not require a separate database append-only trigger or specialized audit
column. Decisions and history rows have no ordinary user-level delete operation;
corrections happen through reassessment and new history. Parent Change Notice deletion follows
Carbon's existing lifecycle and destructive-delete semantics. If the existing parent
delete path explicitly deletes a permitted parent and cascades child feature data,
that operation may remove the associated Impact history as part of the same explicit
delete. This feature does not create a new permanent-retention or undeletable-parent
rule.

### Generic audit comparison

Carbon generic audit currently maps Change Notice root and child tables in
`packages/database/src/audit.config.ts`, but its pipeline is company-configurable,
asynchronous, retention-limited, and the current API permission is not necessarily
available to operational assessors.

Impact-owned source-sensitive snapshots and feature history remain governed by the
source-domain authorization and should not be blindly registered in generic audit
when that store cannot preserve the same authorization. Feature history is the
authoritative Impact reassessment history. Ordinary `changeOrderActionTask` audit
remains governed by Carbon's existing task/audit model. Do not create permanent
deleted-task confidentiality tombstones or reclassify generic historical task audit
solely because a task was once linked to Impact. If an Impact-specific audit
relationship cannot be safely shown, omit or fail closed for that relationship rather
than inventing durable ghost-authorization rows.

## Change Notice Done Behavior

This is an intentional product change.

### Engineering content remains immutable after Done

The following remain frozen:

- engineering affected-item scope;
- Change Notice type and engineering narrative;
- draft methods, BOM/BOP edits, and attributes;
- cutover/supersession configuration;
- release result and engineering status.

### Operational follow-up remains editable after Done

The following remain available to an authorized user:

- supported Impact Decisions that remain current exposure;
- reassessment and resolution of eligible decisions;
- current snapshot comparison and movement to Historical references;
- links between decisions and Change Notice action tasks;
- status, assignee, due date, notes, and completion for tasks marked `Impact follow-up`;
- creation of a new `Impact follow-up` task for current exposure or an existing open
  operational decision;
- read-only visibility of Template-owned and ordinary Manual task links.

Linking a Template-owned or Manual task after Done does not make that task editable.
The task origin marker, not the existence of a decision link, controls post-Done task
editability.

The engineering lock and Impact follow-up lock must be separate. This is not a small
UI exception to `Done = read-only`; it changes the meaning of the lock boundary:

```text
Done = engineering change released
Impact follow-up = may continue after release
```

The UI should communicate this directly:

```text
Done · Engineering released
Operational follow-up: 3 open
```

The Change Notice status does not reopen when an Impact is reassessed, resolved, or
newly discovered. A new engineering scope requires a new Change Notice.

### Current route implications

The current action-task routes use `requireEditableChangeNoticeRoute(... scope:
"workflow")`, which treats Done as closed. The implementation must introduce a
separate operational/Impact guard for supported decision and follow-up operations.
The existing engineering guard must remain closed after Done.

The current Change Notice required-action template reconciliation may remain an
engineering/workflow operation and remain closed after Done. Direct Impact task
creation, explicit task-origin designation before Done, and decision-task linking
must be available through the operational path. The operational path must check the
task origin before permitting a post-Done task edit.

## Cancelled Behavior

Carbon's current code includes a Cancelled off-ramp and a `Cancelled -> Draft` reopen
edge. Cancellation stops the engineering definition, but it must not be treated as
operational closure.

### Considered models

| Model | Behavior | Consequence |
|---|---|---|
| A | Freeze every Impact decision and task immediately | Preserves a simple lock but strands cleanup such as telling a supplier to ignore a cancelled instruction |
| B | Stop new Impact scope and reassessment, but allow existing operational follow-up to be completed or closed | Preserves engineering immutability without stranding work |
| C | Move all cleanup to an owning workflow or new Change Notice | Clean boundary, but forces users to recreate context and can lose the handoff already made |

**V1 recommendation: Model B.**

While Cancelled:

- engineering scope, current candidate discovery, and new Impact assessments stop;
- current decisions and historical references remain visible;
- no new target, provenance relationship, or No Action conclusion is created;
- an existing `Action required` decision may be resolved when its operational cleanup
  is completed;
- an existing `Impact follow-up` task may be completed, edited, unlinked, or replaced
  with another Impact-origin cleanup task attached to that existing open decision;
- Template-owned and ordinary Manual tasks remain read-only;
- a No Action decision cannot be changed into a new conclusion while Cancelled;
- no reassessment or new current-exposure discovery is performed while Cancelled;
- resolving cleanup does not itself reconcile or end provenance, and cancellation is
  not source-deletion or closure evidence;
- the Change Notice does not claim operational closure merely because it was cancelled.

Example:

```text
Supplier received the change instruction.
CN is Cancelled.
Impact follow-up task: Tell supplier to continue Rev A.
Task remains editable because it is Impact follow-up and can be completed.
```

If an authorized user reopens the Change Notice to Draft through the existing
lifecycle, full supported Impact editing and discovery become available again.
Existing decisions, task links, provenance history, and history remain intact.

If cancellation creates a genuinely new operational consequence with no existing
Impact decision, the user must use the owning domain workflow or a new Change Notice;
Cancelled does not become a gateway for new Impact scope.

## Permissions and Tenancy

### View

To open a Change Notice and the Impact workspace, the user needs the existing Parts
Change Notice view capability, currently `parts_view`.

### Assess/update

To create a first decision, reassess, or record/change a No Action or Action Required
conclusion, the user needs:

```text
Change Notice operational-impact update capability
+
read permission for the target source domain
```

To resolve an existing Action Required decision, the user still needs the operational-
impact/source-domain authorization and sufficient trustworthy closure evidence. Current
source read access is used when current facts are required; if current facts cannot be
read, authorized existing evidence or owning-workflow evidence may support resolution
according to the approved closure rules. This exception does not permit a new target,
new conclusion, or automatic closure.

V1 may map the update capability to `parts_update` if that is safe and usable for
Carbon's buyer and production roles. It must not make broad engineering update
permission an irreversible product requirement.

Examples:

- PO line: operational-impact update capability + `purchasing_view`;
- producing Job / Job Material: operational-impact update capability + the
  appropriate production visibility capability;
- Quality/inspection context: `parts_view` + `quality_view` for details.

The exact production read claim follows the current Carbon authorization model. The
current production RLS SELECT policy is employee-role based, so the route must not
infer that broad RLS visibility alone is the product-level assessment permission.

### Underlying source updates

Impact permission never grants:

- `purchasing_update`;
- `production_update`;
- `inventory_update`;
- `quality_update`;
- sales or shipment update capabilities.

The Impact workspace links to owning workflows instead of mutating them.

### Source-domain confidentiality invariant

Impact-owned source-derived evidence inherits the source entity's authorization.
This applies to live candidate context, persisted assessment snapshots, decisions,
rationale/resolution evidence stored in Impact, Impact history, affected-item
provenance when it identifies the operational target, Impact decision-task
relationship metadata, and exact domain counts. Copying those facts into an
Items-owned Impact table, feature history, source-aware DTO, or summary must not
weaken source authorization.

A user with `parts_view` but without `purchasing_view` may see only a non-disclosing
indicator such as:

```text
A restricted Purchasing impact exists.
```

That user must not receive:

- PO number or PO-line identity;
- supplier identity;
- quantities, dates, or operational snapshot values;
- source-derived rationale or resolution notes;
- detailed current or historical decision status if it discloses the restricted
  operational conclusion;
- source-sensitive provenance details;
- Impact decision/task-link relationship metadata that exposes the restricted source;
- exact restricted-record counts in summary metrics.

The user may see that some Impact information is unavailable due to permissions.
The UI may retain non-sensitive Change Notice context, but must not use it to infer
or reveal the restricted source record.

### Restricted sources

If the user lacks source-domain permission:

```text
Restricted
Cannot assess
```

Do not expose source details through a service-role aggregation merely to make the
row assessable. A previously assessed row remains protected: the service returns a
redacted restricted representation, not the raw decision/snapshot/history row. The
user cannot confidently reassess it until source access is available.

Generic audit integration must omit or redact source-sensitive snapshots and
rationale for unauthorized viewers. History queries must apply the same source
permission check as current decision queries; RLS on the Items-owned table alone is
not sufficient to grant access to copied Purchasing or Production evidence. An
ordinary generic Change Notice task is not reclassified by an Impact relationship:
its normal task UI and audit remain under Carbon's existing task permissions, and
V1 does not promise historical source-domain secrecy for arbitrary task text after
unlink or deletion.

All reads and writes remain company-scoped. Service-role or Kysely paths must receive
an already-authorized company and user context from the route and repeat
`companyId` predicates defensively.

## Discovery and Coverage Guarantees

The current `getPartUsedIn()` implementation remains suitable for general Item Used
In screens. It is not the assessment population source because it:

- runs once per affected item;
- performs multiple independent source reads;
- caps many result sets;
- currently maps failed reads to empty arrays through `data ?? []` behavior;
- does not normalize the three supported target identities;
- does not preserve the required affected-item provenance structure;
- does not provide honest complete-coverage semantics.

V1 uses a dedicated Change Notice Impact candidate service/read model for the three
supported domains. It must provide:

- set-based discovery by the distinct affected item IDs;
- typed target identity;
- affected-item provenance;
- document-parent grouping;
- current target context;
- explicit pagination or full-coverage behavior;
- a per-domain coverage result;
- errors that cannot be mistaken for an empty result;
- source permission awareness.

The service must not call one query per affected item or one query per result row.

### Coverage display

Supported assessment summary counts must distinguish:

```text
Current operational exposure
Unassessed
No action required
Action required
Resolved
Changed since assessment
Coverage incomplete / unavailable
```

Historical references are shown separately. Restricted data contributes only a
non-disclosing unavailable-permission warning, not an exact target count.

Context-only references appear separately:

```text
Other impact
Informational context only
```

Do not present a combined `18 impacts / 12 reviewed` metric when the six remaining
rows belong to unsupported or context-only domains.

## Bulk Assessment

Bulk assessment is allowed for independent targets.

Example:

```text
Select 12 current-exposure Job Materials
No action required
Reason: Outside effectivity
Apply to 12
```

Before applying, Carbon must verify:

- target types have compatible semantics;
- every selected row is Current operational exposure;
- all targets are readable;
- no target is Restricted, Historical reference, No longer in current scope,
  Source deleted, or Unavailable;
- current facts and eligibility still match the preview;
- the selected reason is valid for the target domain;
- a shared note is sufficient for all selected rows or ambiguous rows are excluded.

The write creates one decision and one history event per target. The user can review
the affected target list before submission. A concurrent conflict or failed
preflight rejects the bulk operation rather than silently writing a partial,
misleading set.

## Error, Restricted, and Scope-Change Context Behavior

- A source permission failure is shown as Restricted, never as an empty safe result.
- A source service failure or incomplete coverage is shown as Unavailable, with retry
  guidance.
- A deleted source target is shown as Source deleted only when discovery coverage is
  complete.
- A source that still exists but no longer matches current affected items is shown as
  No longer in current scope.
- A source that still exists but no longer meets domain eligibility is shown as a
  Historical reference.
- A target disappearing from an incomplete/capped scan does not delete its decision,
  end provenance, or imply No Action.
- A Changed since assessment decision can still be viewed and historically understood.
- A restricted or unavailable target cannot be newly assessed or reassessed.
- Optimistic row updates roll back if the server rejects the write.
- A bulk write reports the affected target identities when preflight or concurrency
  validation fails.

## End-to-End UX Flows and Scenarios

### 1. Completed PO line

Given PO-104 Line 20 has ordered quantity 100, received quantity 100, and no open
quantity, Carbon classifies it as a Historical reference by default. It does not
create a new Unassessed checkbox or infer No Action. The user can still open the
source PO/receipt/Quality context for possible return, replacement, credit, or
communication work. If a separate current purchasing commitment exists, the line
may become Current operational exposure and then receive a decision.

### 2. Open PO line

Given PO-104 Line 10 is partially received with remaining quantity 300, the user
chooses `Action required`. Carbon offers `Create action task` and the user creates
`Contact supplier about old revision quantity`. The decision remains Action Required
while the task runs.

### 3. Producing Job

Given Job J-51 is In Progress and produces the superseded revision, the workspace
shows its planned, completed, and remaining quantities. The user records `Action
required`, optionally links a production review task, and does not modify the Job or
its method from Impact.

### 4. Job Material

Given Job J-51 has already issued part of the affected material, the Job Material
row shows required, issued, and remaining exposure. The user records Action Required
and links a task to review the issued material. A producing-job decision on J-51, if
present, remains a separate row.

### 5. Several affected parts in one PO

Given CN-50 changes PART-A and PART-B, PO-104 Line 10 references PART-A, and
Line 20 references PART-B, Carbon shows two independent PO-line decisions, each
with its one current affected-item cause. One V1 PO line cannot reference both
items simultaneously. Bulk actions and historical provenance do not collapse the
rows.

### 6. Bulk No Action

Given twelve Current operational exposure rows share the same complete Outside
effectivity proof, the user selects all twelve, chooses `No action required`, and
selects `Outside effectivity`. Carbon previews all twelve, writes twelve current
decisions, twelve snapshots, and twelve history events. Completed Jobs that no
longer have current production exposure are Historical references and are not
eligible for this bulk action.

### 7. Task completes but reveals more work

Given a supplier enquiry task completes and confirms 400 old-revision units exist,
Carbon changes nothing automatically. The task is Completed, but the Impact remains
Action Required. The user can add another task or update the rationale.

### 8. Action happened outside Carbon

Given a supplier was contacted outside Carbon and the cut-in was confirmed, the user
can resolve the existing Action Required decision without creating a fake task. A
required closure note records the external action and evidence. History preserves
that Action Required existed.

### 9. Assessment becomes stale

Given a PO line was assessed at 0/500 received and later reads 200/500, opening or
refreshing the workspace shows `Changed since assessment` and displays the old and
current values. The previous conclusion remains in history. Carbon does not silently
rewrite it or select a new state.

### 10. No Action becomes Action Required

Given a line was marked No Action and a later reassessment finds remaining exposure,
the user changes it to Action Required. Carbon requires an explanation of the new
facts and appends a history row showing the status change.

### 11. Action Required becomes No Action because the original assessment was wrong

Given a user marked a line Action Required but later discovers that the supplier had
already cancelled it before assessment, the user changes it to No Action with a
mandatory correction rationale. Carbon records that the original conclusion was
wrong. It does not call the result Resolved.

### 12. Action Required becomes Resolved because intervention solved it

Given a supplier task completes and the remaining old revision is controlled, the
assessor records a closure note and changes the decision to Resolved. Carbon retains
the Action Required history and does not convert it to No Action.

### 13. Change Notice reaches Done with open Impact work

Given CN-104 reaches Done while three supported decisions are Action Required,
engineering release succeeds. The Change Notice shows `Done · Engineering released`
and `Operational follow-up: 3 open`. An authorized buyer or planner can still update
decisions and linked task follow-up. Engineering fields remain read-only.

### 14. New supported Impact appears after Done

Given a new PO line for the affected item appears after release, the next complete
Impact discovery shows it as Current operational exposure / New / Unassessed only
when the line has an open purchasing commitment. A fully received historical line
appears under Historical references instead. Carbon does not reopen the Change
Notice or copy another decision.

### 15. User lacks source-domain permission

Given a user has Change Notice view/update capability but no `purchasing_view`, a PO
target is not shown as assessable. Carbon may show only a generic `restricted
Purchasing impact exists` indicator. It does not reveal PO number, supplier, quantity, snapshot, source-derived
rationale, detailed Impact history, or Impact decision/task-link metadata, and rejects
any attempt to record a decision. An ordinary linked task may still appear in the
normal Change Notice task UI when existing task permissions allow it; the link does
not reclassify that task or make Operational Impact responsible for its generic text.
It never infers No Action.

### 16. Receipt/inspection Impact appears

Given a receipt and inspection lot reference exists for an affected item, it appears
under Other impact as Informational context only. There are no No Action, Action
Required, or Resolve controls because V1 does not promise receipt-line or inspection-
lot assessment semantics.

### 17. Target no longer belongs to current Impact

Given PO Line 10 references PART-A and has an Action Required decision, when the line
later references PART-C, the source remains present but Carbon marks the PART-A
provenance historical and classifies the target as No longer in current scope. The
decision, history, and task links remain visible under Historical references. Carbon
does not mark it Source deleted, No Action, or Resolved.

### 18. Affected item removed before release

Given CN-50 contains PART-A and PO Line 10 has an Action Required decision, when
PART-A is removed before Implementation, Carbon ends the one current PART-A
provenance relationship, preserves it as historical provenance, and moves the
target out of Current operational exposure. The existing decision and task links
remain understandable; no state is auto-resolved. If the source row later changes
to PART-B while PART-B is in the Change Notice, that is a new current interval,
not a simultaneous second cause.

### 19. First assessment after intervention already completed

Given a current operational-exposure New / Unassessed PO line, the buyer records
that the supplier was contacted
the previous day and cut-in is complete. Carbon allows direct `Resolved` with a
mandatory closure rationale/evidence, actor, time, and snapshot. It does not require
an artificial Action Required save first.

### 20. CN cancellation requires operational cleanup

Given a supplier received a change instruction and the Change Notice is then
Cancelled, an existing Impact follow-up task telling the supplier to reverse or
ignore the instruction remains editable and completable. New Impact scope and
reassessment are stopped. A Template-owned task remains read-only. If there is no
existing open Impact decision, cleanup moves to the owning workflow or a new Change
Notice.

## Acceptance Criteria

### Workspace and target identity

- [ ] Given a PO with two currently eligible affected lines, the workspace shows one
      PO group and two independently assessable rows.
- [ ] Given a completed PO line with no open purchasing commitment, the workspace
      shows a Historical reference and does not create an Unassessed decision row.
- [ ] Given a Job that produces an affected item and consumes another affected item,
      the workspace shows eligible producing-Job and separate Job Material rows;
      terminal Jobs appear under Historical references.
- [ ] A target has at most one current affected-item cause in V1; when its scalar
      source item changes, the prior cause becomes historical and the new cause is
      represented by a successive interval on the same decision row.
- [ ] A bulk action applied to twelve Jobs produces twelve independent decisions and
      twelve assessable history entries.
- [ ] Context-only receipts, inspections, sales, shipments, and other references are
      labeled Informational context only and do not affect supported assessment counts.
- [ ] The existing ImpactPanel links to the workspace and does not present the
      legacy where-used list as complete assessment coverage.

### Decision semantics

- [ ] A supported target with no decision displays New / Unassessed without a
      persisted Unassessed row.
- [ ] A deterministic current-exposure target can be marked No action required with
      a valid domain reason and no redundant written prose where the evidence rule
      permits it.
- [ ] A completed Job or fully received PO line is not automatically eligible for
      No Action solely because its remaining quantity is zero.
- [ ] `Not affected after review` requires written rationale.
- [ ] `No purchasing intervention remains` requires one explicit attestation that
      return, replacement, credit, and communication work do not remain, plus written
      rationale; separate booleans are not required.
- [ ] A target marked Action required can create or link an existing Change Notice
      action task.
- [ ] A task can link to several decisions, and one decision can link to several
      tasks, without creating per-decision task-status copies.
- [ ] Completing a linked task does not automatically resolve any Impact Decision.
- [ ] An Impact-created task uses generic wording by default and does not automatically
      copy restricted PO, Job, or Job Material fields into generic task title, notes,
      or external metadata; source-specific context remains in the authorized Impact
      workspace.
- [ ] Resolved requires an explicit authorized user action and a closure note or
      equivalent outcome evidence.
- [ ] A decision can be resolved without a task when the work occurred outside
      Carbon, without forcing a fake task.
- [ ] A current operational-exposure New / Unassessed target can be recorded
      directly as Resolved when required intervention already happened, with mandatory
      closure evidence.
- [ ] Action Required -> No Action records a correction rationale and is visibly
      distinct from Action Required -> Resolved.
- [ ] Linking an ordinary Template-owned or Manual task does not make it editable
      after Done; only an explicit Impact follow-up origin does.
- [ ] The UI contains no Not Applicable or Accepted Exposure Impact states.
- [ ] `Already handled elsewhere` is not offered as an ordinary No Action reason.

### Freshness and discovery

- [ ] Given an assessment snapshot of 0/500 received and a current source value of
      200/500, the row visibly says Changed since assessment and shows both values.
- [ ] A changed decision remains historically visible and is not silently rewritten.
- [ ] A source change does not automatically choose No Action, Action Required, or
      Resolved.
- [ ] A new supported target after Done appears Current operational exposure / New /
      Unassessed only when its domain eligibility rule is true.
- [ ] A newly discovered historical relationship appears under Historical references
      without creating an assessment obligation.
- [ ] A target whose source still exists but no longer matches affected items shows
      No longer in current scope, not Source deleted.
- [ ] A target disappearing from an incomplete scan is not treated as Source deleted
      or No Action.
- [ ] A complete supported-domain query that cannot find a previously stored target
      shows Source deleted and blocks confident reassessment.
- [ ] Discovery reports domain coverage and does not convert source permission or
      service failures into empty safe results.
- [ ] Summary counts separate current supported exposure, historical references,
      context-only impact, and non-disclosing restricted coverage.

### Post-Done and Cancelled behavior

- [ ] A Change Notice can reach Done with open supported Impact decisions; release
      still runs the existing engineering apply path.
- [ ] After Done, an authorized user can reassess a supported decision, resolve it,
      and update linked operational task follow-up.
- [ ] After Done, engineering affected items, draft methods, BOM/BOP content,
      cutover configuration, and engineering narrative remain immutable.
- [ ] A new post-release current exposure does not change the Change Notice
      engineering status.
- [ ] A Cancelled Change Notice stops new Impact discovery and reassessment but allows
      an existing Impact follow-up task and Action Required decision to be completed
      or resolved.
- [ ] A Cancelled Template-owned or ordinary Manual task remains read-only.
- [ ] Reopening a Cancelled Change Notice through the existing lifecycle restores
      the ability to edit supported Impact decisions without deleting history.

### Permissions and evidence

- [ ] A user without the source-domain read capability cannot record a decision for
      that target.
- [ ] Restricted source context never appears as No Action.
- [ ] A user with Change Notice view but without `purchasing_view` cannot see PO
      number, supplier, quantity, snapshot, source-derived rationale, detailed Impact
      history, or Impact decision/task-link metadata for an existing PO decision.
- [ ] An ordinary linked Template-owned or Manual task remains governed by Carbon's
      existing Change Notice task permissions; the Impact link does not reclassify it,
      and V1 does not promise source-domain confidentiality for generic task text after
      linking, unlinking, or deletion.
- [ ] Restricted summary output does not reveal exact restricted-record counts.
- [ ] Impact permissions do not allow updates to the underlying PO, Job, Job Material,
      Receipt, Inventory, Shipment, or Quality record.
- [ ] All decision, provenance, history, and task-link reads and writes are scoped to
      the active company.

### History

- [ ] Creating a decision writes a durable history row in the same transaction as
      the current decision.
- [ ] Changing status, reason, rationale, resolution note, or material snapshot
      writes a new durable history row.
- [ ] A no-op save does not create a duplicate history event.
- [ ] History shows actor, time, prior conclusion, new conclusion, reason, rationale,
      and assessment evidence.
- [ ] History remains available when generic audit logging is disabled while the
      parent Change Notice exists.
- [ ] Decisions and history have no ordinary user-level delete operation; parent
      Change Notice deletion follows the existing Carbon lifecycle and explicit
      destructive-delete semantics.
- [ ] Generic audit, when enabled and source-authorized, provides supplementary
      field-level diffs without being the only history source.
- [ ] History displays Task linked and Task unlinked events with actor, time, and task
      identity, without copying task status history.
- [ ] History displays provenance-ended events when an affected item is removed or a
      source target stops matching the current affected-item set.

### Exposure and scope-change scenarios

- [ ] A completed PO line with no open purchasing commitment is shown as Historical
      reference, not New / Unassessed and not automatic No Action.
- [ ] An active Job Material with issued quantity equal to required quantity remains
      Current operational exposure when its parent Job is active.
- [ ] When a PO line changes from PART-A to PART-C, PART-A provenance becomes
      historical and the target is No longer in current scope; the source is not
      labeled Source deleted.
- [ ] When PART-A is removed from a Change Notice before Implementation, existing
      decisions, history, and task links remain, current PART-A provenance ends, and
      no decision is auto-resolved or changed to No Action.
- [ ] A current operational-exposure New / Unassessed target can be recorded
      directly as Resolved with closure evidence when intervention happened before
      first assessment.
- [ ] When a Change Notice is Cancelled, existing Impact-origin cleanup remains
      completable while new discovery and reassessment stop.

### Canonical snapshots

- [ ] Every PO-line decision uses the same `PO_LINE_SNAPSHOT_V1` key structure.
- [ ] Every producing Job decision uses the same `JOB_SNAPSHOT_V1` key structure.
- [ ] Every Job Material decision uses the same `JOB_MATERIAL_SNAPSHOT_V1` key
      structure, including issued/consumed exposure where authoritative.
- [ ] Cosmetic display changes do not create Changed since assessment; a change to a
      canonical decision-relevant value does.

## Product Verification

The implementation plan must include user-facing verification with seeded examples
for all twenty scenarios above. Decision persistence, trustworthy freshness behavior,
source-coverage correctness, and authorization must ship as one externally usable
product boundary. They may be implemented as separate internal slices behind a
feature flag or hidden route, but Carbon must not expose a persistent green No Action
workflow while changed facts, incomplete discovery, or permission failures can look
like safe emptiness. The plan must also run the smallest relevant Carbon checks for
changed packages and database types after any schema work. No implementation is part
of this spec.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Users read a local No Action decision as a global safety statement | High | Target-local copy, document grouping, separate context-only section, no global green badge |
| Discovery remains incomplete or permission-filtered | High | Dedicated set-based candidate service, per-domain coverage, Restricted/Unavailable handling, no empty-as-safe fallback |
| Post-Done editing appears to contradict immutable engineering history | High | Separate engineering and operational lock scopes, explicit `Done · Engineering released` copy, no status reopen |
| Generic audit is mistaken for guaranteed feature history | High | Durable append-only Impact history in the same write transaction; generic audit supplementary |
| Task completion is treated as consequence closure | High | Separate decision state, no automatic transition, explicit resolver and closure note |
| Parent-level decisions hide line-level exceptions | High | Typed target identity, one row per PO line/Job/Job Material, no inherited parent decision |
| Snapshot fields are too broad and create noisy stale warnings | Medium | Define decision-relevant fields separately from display context; start with smallest material set |
| Snapshot fields are too narrow and miss a material source change | High | Field-contract acceptance scenarios, snapshot versioning, domain-owner review during implementation planning |
| Many-to-many task links become confusing | Medium | Show linked task names on each row, keep one task status, require explicit decision resolution |
| Parent deletion removes feature history | Medium | Preserve append-only history while the parent exists; follow existing Change Notice destructive-delete semantics and make the parent delete explicit |
| Historical references become checkbox obligations | High | Apply domain-specific Current operational exposure eligibility before creating Unassessed rows |
| Source-domain evidence leaks through Items-owned snapshots or history | High | Enforce source authorization and redact current/history/task/provenance details; do not rely on Items RLS alone |
| Scope expands into Quality, inventory, and PLM risk workflows | High | Explicit context-only and non-target boundaries; no Accepted Exposure or Not Applicable |
| New source tables have inconsistent tenant keys | Medium | Keep target identity constrained to three V1 types; service validates source company; implementation planner verifies current keys before adding FKs |
| Task links accidentally unlock ordinary Change Notice tasks | High | Persist task origin/purpose; linking never changes origin; only Impact follow-up tasks are editable after Done |
| Cancellation strands cleanup work | High | Stop new scope/reassessment but allow existing Impact follow-up completion and resolution |
| Bulk actions hide row-specific differences | Medium | Preview, current-exposure guard, compatible target-domain guard, per-row snapshots and history, reject stale/restricted selections |

## Open Questions

> Product discovery questions were resolved before writing this spec. The items below
> are recorded as decisions, not implementation to-dos. Manufacturer validation items
> are assumptions in Part 3 and do not block this draft.

- [x] **Which domains receive full assessment in V1?** — **Answer:** Purchase
      Order lines, producing Jobs, and Job Materials only. Each domain applies a
      current-exposure eligibility rule before a row can become New / Unassessed.
      Receipts, inspections, inventory, sales, shipments, and other references are
      context-only or deferred.
- [x] **What is the persisted decision identity?** — **Answer:** One decision per
      independently reassessable target, keyed by Change Notice plus target type and
      source row ID. Affected items are provenance links.
- [x] **Should Job headers and Job Materials share one decision?** — **Answer:** No.
      Producing Job and consuming Job Material consequences are separate targets.
- [x] **Should receipt-line decisions ship in V1?** — **Answer:** No. Receipt and
      inspection context may be visible, but full assessment waits for a trustworthy
      lot/inspection target contract.
- [x] **What are the Impact states?** — **Answer:** Persistent `No action required`,
      `Action required`, and `Resolved`; Unassessed, Changed since assessment,
      Restricted, Historical reference, No longer in current scope, Source deleted,
      and Unavailable are derived conditions.
- [x] **What does No Action mean?** — **Answer:** No operational intervention is
      required for this specific target because of this Change Notice. It is not a
      global safety statement.
- [x] **Is written rationale always required?** — **Answer:** No. Structured reason
      plus deterministic Carbon evidence can be sufficient. Ambiguous judgments,
      Not affected after review, and conclusion-changing reassessments require prose.
- [x] **What does Resolved mean?** — **Answer:** An assessor explicitly confirms that
      an operational consequence requiring intervention is closed. A first assessment
      for a current operational-exposure target may go directly to Resolved when the
      intervention already happened. Task
      completion alone is insufficient.
- [x] **Should Accepted Exposure or Not Applicable remain?** — **Answer:** No. They
      are removed from the top-level model and handled by authoritative domain
      workflows or No Action reasons.
- [x] **What happens after Done?** — **Answer:** Engineering content remains immutable;
      supported Impact decisions and operational follow-up remain editable under a
      separate lock scope. Done is not operational closure.
- [x] **What happens after Cancelled?** — **Answer:** New Impact scope and
      reassessment stop, but existing Impact follow-up tasks and Action Required
      decisions may be completed or resolved. Template-owned tasks remain locked. The
      existing Cancelled -> Draft reopen path restores full editing.
- [x] **Does V1 gate Done on Impact completion?** — **Answer:** No. Engineering
      release succeeds without requiring all candidates to be assessed or resolved.
- [x] **What history does V1 promise?** — **Answer:** Guaranteed feature-owned
      reassessment, task-link, and provenance-change history while the parent Change
      Notice exists, independent of generic audit settings and retention. Generic
      audit is supplementary; parent deletion keeps existing Carbon semantics.
- [x] **Which relationships create an assessment obligation?** — **Answer:** Only
      Current operational exposure under the domain-specific PO line, producing Job,
      and Job Material rules. Historical references do not create Unassessed rows.
- [x] **What happens when a source remains but leaves current scope?** — **Answer:**
      Show No longer in current scope or Historical reference as appropriate, preserve
      current/historical provenance and decisions, and never infer No Action or
      Resolved.
- [x] **Can first assessment go directly to Resolved?** — **Answer:** Yes, for a
      current operational-exposure target when the intervention already happened;
      closure evidence is mandatory and no fake Action Required transition is created.
- [x] **What controls task editability after Done?** — **Answer:** A durable task
      origin/purpose marker. Impact follow-up tasks are editable; Template-owned and
      ordinary Manual tasks remain read-only. Linking never changes origin.
- [x] **What may continue after Cancelled?** — **Answer:** Existing Impact follow-up
      cleanup and Action Required resolution may continue; new scope, discovery, and
      reassessment stop. Existing lifecycle reopen restores full editing.
- [x] **How is source evidence protected in Impact tables and history?** — **Answer:**
      Impact-owned source-derived evidence inherits source-domain authorization.
      Unauthorized users receive only a non-disclosing restricted indicator, not source
      IDs, quantities, snapshots, rationale, detailed Impact history, provenance, exact
      counts, or Impact decision/task-link metadata. Ordinary generic task content
      remains under Carbon's existing Change Notice task permissions; linking does not
      reclassify it, and V1 does not promise historical source-domain secrecy for
      arbitrary task text after unlink or deletion.
- [x] **How are snapshots compared?** — **Answer:** Each V1 target type uses one
      deterministic canonical schema: `PO_LINE_SNAPSHOT_V1`, `JOB_SNAPSHOT_V1`, or
      `JOB_MATERIAL_SNAPSHOT_V1`. Display-only fields are excluded.

## Changelog

- 2026-09-07: Implemented Slice 5D search and filtering in the existing document-first workspace. Search and filters stay URL-backed and client-side over the authorized browser DTO; coverage summaries remain authoritative and incomplete candidate/task coverage is disclosed.
- 2026-09-05: Recorded the current Slice 4 implementation status. The read-only
  workspace exposes the three supported assessment domains, keeps decision/task UX
  out of the slice, and shows an informational notice instead of loading legacy
  mixed-domain context-only rows. Focused verification is tracked in the implementation
  plan; Slice 5/6 remain pending.
- 2026-08-24: Created from the completed read-only Carbon Change Notice Operational
  Impact Assessment discovery and design investigation. No application code,
  migrations, issues, branches, or PRs were created or modified.
- 2026-08-24: Focused revision pass. Added current-exposure eligibility versus
  Historical references, explicit scope/provenance changes, direct first-assessment
  resolution, domain-specific No Action semantics, task-origin editability, Cancelled
  cleanup behavior, source-domain confidentiality, deterministic snapshot contracts,
  task/provenance history events, and compatibility with existing parent deletion.
- 2026-08-24: Security clarification pass. Kept source-domain authorization for all
  Impact-owned evidence and relationship metadata, but clarified that ordinary linked
  tasks retain Carbon's existing task authorization and that Impact-created task origin
  controls lifecycle only; no generic task taint, confidentiality ledger, or deleted-task
  tombstone is a product requirement.
- 2026-08-28: Carbon compatibility correction. Constrained V1 current provenance to
  one scalar source-item cause per target while retaining interval history; made
  provenance end explanations use the interval `endedReason` plus history `rationale`,
  kept `Outside effectivity` unavailable until server-side proof exists, simplified
  purchasing confirmation to one explicit attestation, made operation classification
  server-derived, and clarified source deletion versus explicit resolution.

# Part 2 - Proposed Technical Architecture

This section records a Carbon-native implementation shape for feasibility review.
Part 1 is authoritative for product behavior. The implementation plan is authoritative
for the exact migration and table shape. Part 2 preserves the architectural invariants,
relationship semantics, security boundaries, and transaction requirements without
becoming a competing migration specification.

## Candidate read model and service

Keep Change Notice logic in the Items module:

```text
apps/erp/app/modules/items/items.models.ts
apps/erp/app/modules/items/items.service.ts
apps/erp/app/modules/items/items.server.ts
apps/erp/app/modules/items/ui/
```

Do not create a standalone `impact` module or separate `changeNotice.*` service files.

Add one service façade conceptually named:

```text
getChangeNoticeImpactCandidates(client, companyId, changeNoticeId, options)
```

The façade should:

1. Load the Change Notice's affected items once.
2. Build the distinct affected item ID set.
3. Batch-query PO lines, producing Jobs, and Job Materials by item ID and company.
4. Normalize each source row into a typed candidate union.
5. Deduplicate by `(targetType, targetId)`.
6. Attach the matching affected-item cause as provenance; V1 has at most one
   current cause per target.
7. Reconcile current versus historical provenance against the current affected-item
   set; never delete ended provenance.
8. Apply domain-specific eligibility and classify Current operational exposure versus
   Historical reference or No longer in current scope.
9. Attach parent-document grouping and current context.
10. Return per-domain coverage and cursor information.

The first implementation should use source-specific set-based reads and Carbon's
existing pagination helpers rather than looping over affected items. A SQL projection
or `SECURITY INVOKER` RPC is acceptable if it is needed for efficient parent joins or
pagination, but it must return the same typed target identity, provenance, and
coverage contract. Do not build a registry that dynamically queries arbitrary tables.

`getPartUsedIn()` remains unchanged for unrelated Item Used In screens. It is not
replaced globally by this feature.

### Candidate response shape

Conceptually:

```ts
type ChangeNoticeImpactCandidate = {
  targetType: "purchaseOrderLine" | "job" | "jobMaterial";
  targetId: string;
  parent?: {
    type: "purchaseOrder" | "job";
    id: string;
    readableId: string;
    name?: string | null;
  };
  context: PurchaseOrderLineContext | JobContext | JobMaterialContext;
  currentProvenance: {
    affectedItemId: string;
    itemReadableId: string;
    status: "Current";
    endedReason: null;
  }[]; // zero or one current cause in V1
  historicalProvenance: {
    affectedItemId: string;
    itemReadableId: string;
    status: "Historical";
    endedReason: string; // required for an ended interval
  }[];
  exposureClassification:
    | "Current operational exposure"
    | "Historical reference"
    | "No longer in current scope";
  sourceAvailability: "Present" | "Restricted" | "Source deleted" | "Unavailable";
};

type ChangeNoticeImpactCoverage = {
  targetType: string;
  complete: boolean;
  nextCursor: string | null;
  restricted: boolean;
  unavailable: boolean;
};
```

A failed source read must be represented in coverage/error data. It must not be
converted to `[]` by a loader. The candidate service applies the PO line, producing
Job, and Job Material eligibility rules before the workspace decides whether a row is
Current operational exposure or Historical reference.

Cursor compatibility is part of this read contract. Carbon's supported source IDs
are generated Base58 `id()` values; SQL uses `ORDER BY id` with a strict `id >
cursor` predicate. In-memory merge and cursor comparisons must preserve the ordering
behavior verified against Carbon's actual PostgreSQL and ERP runtime, so database
cursor ordering and in-memory continuation ordering remain consistent. Mixed-case
Base58 IDs must be covered by regression tests so continuation pages do not skip or
repeat targets.

## Decision persistence

The implementation plan is authoritative for the exact migration and table shape.
This section records the architectural invariants without duplicating migration SQL.

### Decision identity and fields

`changeOrderImpactDecision` stores one current decision per supported target. Its
identity is:

```text
(companyId, changeNoticeId, targetType, targetId)
```

V1 target types are fixed to:

```text
purchaseOrderLine
job
jobMaterial
```

`targetId` is the retained historical source identifier. There are no typed nullable
source-ID columns and no foreign keys from the decision to PO Line, Job, or Job
Material. This is required for the valid `Source deleted` state.

Important decision fields are:

```text
id, companyId, changeNoticeId
targetType, targetId
decisionStatus
noActionReasonCode, rationale, resolutionNote
assessmentSnapshot, snapshotVersion
assessedBy, assessedAt, revision
createdBy, createdAt, updatedBy, updatedAt
```

The table has a fixed target-type CHECK, status/reason constraints, a unique decision
identity across company/Change Notice/type/target, and indexes for Change Notice and
target reads. It retains normal company and Change Notice ownership relationships.

When creating or reassessing, the service validates that the source exists, belongs to
the active company, matches `targetType`, belongs to the Change Notice's permitted
scope, and is readable under the source-domain authorization. A source deletion does
not delete or block the decision. Complete source reconciliation instead presents:

```text
Source availability: Source deleted
Decision: preserved
Assessment snapshot: preserved
Target identity: preserved
History: preserved while the parent Change Notice exists
```

The decision has no ordinary user-level delete operation. Corrections are updates plus
history. Parent Change Notice deletion continues to follow Carbon's existing
lifecycle and destructive-delete semantics.

## Affected-item provenance

`changeOrderImpactDecisionAffectedItem` records the historical relationship between a
decision and the affected-item cause that led it to be discovered. For the three V1
source target types, one target has at most one current cause because each source
row has one scalar `itemId` and the Change Notice prevents duplicate `(changeOrderId,
itemId)` rows. The implementation plan is authoritative for the exact fields.
Conceptually, it contains:

```text
id, companyId, decisionId
affectedItemId, affectedItemSourceId, affectedItemLabel
startedAt, startedBy
endedAt, endedBy, endedReason
createdBy, createdAt, updatedBy, updatedAt
```

The identifiers and labels are feature-owned historical evidence. The provenance row
has a live ownership relationship to the Impact Decision and company, but it must not
have a foreign key to the live `changeOrderAffectedItem` row. The existing partial
unique index protects one open interval per decision/affected-item pair; the
at-most-one-current-cause rule for V1 comes from the scalar source columns and must
be enforced by the service rather than by inventing additional simultaneous causes.

Current provenance is an interval. When an affected item is removed from the Change
Notice, the service ends the current interval and records its reason. If the scalar
source item later changes to another affected item in the same Change Notice, the
old interval ends and a new interval starts; the causes are sequential, not
simultaneous. It preserves the historical identifier/label, decision, snapshot, and
history. It does not delete the provenance, block affected-item removal, resolve the
decision, or infer No Action.

## Durable reassessment history

`changeOrderImpactDecisionHistory` is the authoritative feature-owned reassessment
history. The implementation plan is authoritative for its exact fields. Important
content includes:

```text
id, companyId, decisionId
targetType, targetId
eventType
previousStatus, newStatus
previousReasonCode, newReasonCode
previousSnapshot, newSnapshot
rationale, resolutionNote
relatedActionTaskId, relatedAffectedItemId
priorAssessmentWasChanged
createdBy, createdAt, updatedBy, updatedAt
```

The minimum event set covers decision creation, reassessment, correction, resolution,
reopening, task linking/unlinking, and provenance start/end. History rows contain the
status/snapshot context needed to explain the event and are append-only by the
Impact service contract while the parent Change Notice exists.

For a `Provenance ended` event, the structured end reason is stored on
`changeOrderImpactDecisionAffectedItem.endedReason`. The history row records the
event explanation in its existing `rationale` field and identifies the historical
relationship with `relatedAffectedItemId`; the history table has no separate
`endedReason` column.

`relatedActionTaskId` and `relatedAffectedItemId` are historical identifiers. They are
not live foreign-key dependencies. A `Task linked`, `Task unlinked`, `Provenance
started`, or `Provenance ended` event remains understandable after the related task or
live affected item is deleted. History retains the identifier for traceability.

History has live ownership through company and Impact Decision relationships. It has
no ordinary user-level update/delete path while the parent exists. Parent Change
Notice deletion continues to follow Carbon's existing destructive-delete semantics and
may remove the feature history with the parent.

## Action-task linkage

`changeOrderImpactDecisionActionTask` is the live many-to-many relationship between
Impact Decisions and Change Notice action tasks. The implementation plan is
authoritative for its exact fields. It contains the decision/task/company identity and
standard audit fields, with a reverse task index.

The link table has live ownership relationships to the Impact Decision and company.
A current task FK/cascade may be used where appropriate for the live link, but task
removal must not rewrite or invalidate historical Impact history. History stores task
IDs as historical references rather than depending on the current task row.

The link table stores relationship metadata only. It does not store or override task
status. A task can support many decisions, and a decision can link many tasks.

The only existing task schema addition is `changeOrderActionTask.taskOrigin`, with:

```text
Template-owned
Manual
Impact follow-up
```

Impact-created tasks use `Impact follow-up`. Explicit pre-`Done` designation may change
an existing task's origin. Linking an ordinary Template-owned or Manual task does not
change its origin. Origin controls post-`Done` editability only; it is not a source
confidentiality classification.

## Live ownership and historical references

The relationship boundary is deliberate:

| Relationship | Treatment |
|---|---|
| Impact Decision → Change Notice | Live parent FK with existing Carbon parent-delete semantics |
| Provenance → Impact Decision | Live ownership FK |
| Task link → Impact Decision | Live ownership FK |
| Task link → current task | Live FK/cascade where appropriate for the current relationship |
| Impact history → Impact Decision | Live ownership FK |
| Any feature row → company | Company FK/scoping where Carbon convention requires it |
| Decision → PO Line/Job/Job Material | Historical target identity only; no source FK |
| Provenance → Change Notice affected item | Historical identifier/label only; no live source FK |
| History → related task/affected item | Historical identifier only; no live reference dependency |

The implementation plan is authoritative for the exact migration/table shape. The
specification intentionally describes the invariant rather than a competing SQL
migration.

## Atomic decision writes

Impact lifecycle authorization is operation-specific. The service must not use one
binary Impact-editable guard for every mutation. It derives an internal operation
from the existing decision and the requested conclusion/evidence, then evaluates
the Change Notice lifecycle, decision state, exposure state, target/source
availability, and task origin where relevant. The caller does not select a public
operation enum or history event type.

| Operation | Required precondition | Historical / no longer current | Cancelled |
|---|---|---|---|
| Create first decision, including direct first-time Resolved | Readable/Present source, complete trustworthy coverage as applicable, current provenance, Current operational exposure, and normal lifecycle | Denied | Denied |
| Reassess existing decision | Readable/Present source, Current operational exposure, and normal lifecycle | Denied | Denied |
| Record No Action | Current assessable exposure and valid current evidence | Denied | Denied |
| Record or reopen Action Required | Current operational exposure and normal lifecycle | Denied | Denied |
| Resolve existing Action Required | Existing persisted open decision, authorized closure evidence, state/CAS/task prerequisites; Current exposure is not universally required | Allowed with closure evidence | Cleanup-only |
| Create an Impact follow-up task | Current/open decision rules in normal lifecycle; existing open Action Required for Cancelled cleanup | Existing decision rules | Cleanup-only for existing open Action Required |
| Link or unlink through Impact | Existing decision/task and operation-specific relationship rules | Existing decision/history rules | Cleanup-only |
| Designate an ordinary task as Impact follow-up | Existing pre-Done designation rules | Denied | Denied |
| Edit an ordinary Template-owned/Manual task | Existing workflow rules | Existing workflow rules | Denied | Denied |
| Edit an Impact follow-up task | Existing Impact follow-up task and no new scope | Allowed | Allowed for existing cleanup |

`Source deleted`, `Restricted`, and `Unavailable` never become an automatic
conclusion. Resolution of an existing Action Required decision may proceed only when
existing authorized evidence or the owning workflow provides enough trustworthy
closure evidence; missing current source facts do not invent a new conclusion.

The service flow is:

```text
authorize user/company/source context
        ↓
load Change Notice
        ↓
load existing decision if any
        ↓
derive the internal operation from persisted state + requested conclusion
        ↓
apply operation-specific lifecycle and exposure preconditions
        ↓
load/normalize current source evidence where required
        ↓
validate state transition, task prerequisites, and closure evidence
        ↓
CAS/revision validation
        ↓
Kysely transaction
        ↓
decision + provenance + history + links as required
```

For create, reassess, No Action, and new/reopened Action Required, Current
operational exposure is required. For `Action required → Resolved`, an existing open
decision and sufficient closure evidence are required, but the target may be a
Historical reference or No longer in current scope. A first-time `Resolved` decision
still requires current assessable exposure and evidence that intervention already
occurred.

Inside the transaction, insert/update the decision, start/end provenance, update live
links, and append meaningful feature history as required by the selected operation.
No history row is written for a no-op or failed operation. Bulk operations preflight
every selected operation with the same operation-specific rules; an ineligible row or
CAS conflict rejects the bulk operation rather than producing partial success.

A stale `revision` rejects the write with a user-facing “This assessment changed;
refresh and reassess” result. Supabase service functions continue to take the client
first and return raw `{data, error}` responses. The multi-row current/history write
uses the existing Kysely database client, with route authorization and explicit
company predicates because Kysely bypasses RLS.

The transaction should lock the Change Notice when lifecycle or scope ownership
must be serialized, the affected scope row when a scope mutation is in the same
transaction, an existing Impact Decision when comparing/updating its revision, and
current persisted provenance rows while reconciling them. Re-read lifecycle and
parent/child ownership inside the transaction and use a deterministic lock order.
It should not lock PO Lines, POs, Jobs, Job Materials, Items, or method/evidence
rows merely because they are read as assessment evidence; no concrete Impact-owned
invariant requires those source rows to be locked by default.

The requested conclusion and expected revision are the public decision inputs;
server-side state determines whether the write is a creation, reassessment,
correction, reopening, direct first resolution, same-state update, or no-op.

## Post-Done and Cancelled server guards

The implementation should preserve separate engineering, workflow, and operational
scopes, but the operational scope is operation-specific:

```text
engineering
workflow / CN-wide template operations
impact / operation-specific operational follow-up
```

The server chooses authorization from the requested operation, Change Notice
lifecycle, decision state, exposure/target state, and task origin where relevant. It
must not use one global Impact guard that treats every mutation identically.

- **Before Done:** supported create, reassess, conclusion, resolution, and task
  operations follow the normal lifecycle and target-state rules.
- **Done:** engineering definition and workflow/template operations remain locked;
  supported operational Impact discovery, first assessment, reassessment, resolution,
  Impact task creation, task linking/unlinking, and Impact follow-up task edits remain
  available when their operation-specific preconditions pass.
- **Cancelled:** new scope discovery, first assessment, reassessment, No Action,
  new/reopened Action Required, conversion/designation of ordinary tasks into Impact
  follow-up, and unrelated Impact work are denied. Cleanup remains
  available for an existing open Action Required decision and existing Impact
  follow-up work, including permitted task edits, completion, linking/unlinking, and
  replacement cleanup task creation. Ordinary Template-owned and Manual tasks remain
  locked. Reopening to Draft restores normal supported Impact editing.

The action-task status route currently uses the workflow scope. The implementation
must separate task mutations used by Impact from CN-wide template reconciliation so
post-Done follow-up cannot accidentally reopen engineering edits or delete the
historical task set. An Impact cleanup task in Cancelled may be created or replaced
only for an existing open Action Required decision.

The Done route must continue to call `applyChangeNotice()`, and the implementation
must preserve its status re-read and `Implementation` check. The route should also
validate the submitted `fromStatus` before entering the Done path so an arbitrary
`toStatus = Done` submission cannot bypass the intended transition contract.

## Permissions and RLS architecture

Impact-owned decision, provenance, history, and relationship metadata use `companyId`
and source-aware Carbon RLS. Source-bearing reads require both Change Notice access
and the relevant source-domain view capability:

```text
PO Impact             → parts_view + purchasing_view
Job Impact            → parts_view + production_view
Job Material Impact   → parts_view + production_view
```

Impact writes use the current V1 mapping, with an operation-specific source rule:

```text
create/reassess/conclusion change:
parts_update + source-domain read

resolve existing Action Required:
parts_update + Impact/source-domain authorization
+ sufficient authorized closure evidence
```

No new permission family is required. The route performs the permission checks before
calling a Kysely transaction, and every server mutation repeats explicit company,
Change Notice, target, lifecycle, and source-access predicates. Authorized server code
may use Kysely or service-role operations according to Carbon's existing conventions.

Candidate reads use the requesting user's RLS client where possible. If a privileged
server read is needed for set-based aggregation, the route first establishes the
permitted source-domain scope. The read model returns Restricted or Unavailable
coverage instead of disclosing inaccessible rows or treating a failed read as empty.

Raw source-bearing Impact rows must not be exposed directly through an Items-owned
PostgREST read to every `parts_view` user. The service/RPC boundary and source-aware
DTO apply the same source-domain authorization to current decisions, snapshots,
provenance, feature history, relationship metadata, and exact counts. Without the
corresponding source capability, the caller receives only the non-disclosing
restricted representation described in Part 1.

Supported ERP, API, integration, and MCP paths use the same permission-aware service
boundary. MCP authentication supplies user/company context but does not replace the
feature's `parts_update` and source-domain checks.

Ordinary Template-owned and Manual Change Notice tasks retain Carbon's existing task
permissions. An Impact link does not reclassify their global authorization. The link
metadata itself remains source-authorized, and Impact-created task text must not copy
restricted PO, Job, or Job Material facts into generic title, notes, or external
metadata. Generic audit remains supplementary; raw Impact source snapshots and
source-derived rationale are excluded from generic audit in V1 unless a future
authorization-preserving projection is designed.

## Pagination, coverage, and indexes

The candidate service must not assume that a single PostgREST response is complete.
It should use Carbon's pagination helpers or explicit cursor pagination. The UI can
show a paged workspace, but summary totals must carry a complete/partial indicator.

The planner should verify current indexes before adding new ones. Expected useful
indexes are:

- source-domain `(companyId, itemId)` indexes for PO lines, Jobs, and Job Materials
  if not already present;
- decision `(companyId, changeNoticeId)`;
- unique decision target key;
- reverse target lookup for reassessment/source refresh;
- provenance by affected item;
- task links by task ID;
- history by decision and descending creation time.

No index is justified merely because a column appears in the conceptual schema.

## Concurrency and idempotency

- Current decision writes use an integer revision or equivalent compare-and-swap.
- Repeating the same bulk request must not create duplicate decision rows or duplicate
  provenance/task links.
- Repeating a history write after a committed response must be prevented by the
  transaction's unique/current-row update behavior or a request idempotency key.
- Reassessment after a source change never deletes the prior snapshot.
- A new candidate after Done inserts at most one current decision row for its target
  identity.
- A retry after a failed transaction leaves neither a current update nor an orphan
  history row.

## Proposed service and route surface

Names are illustrative and remain subject to the implementation plan. A decision
writer may have internal helpers for individual transitions, but its public input
must not expose caller-selected operation types:

### Items service/server

```text
getChangeNoticeImpactCandidates(client, companyId, changeNoticeId, options)
getChangeNoticeImpactDecisions(client, companyId, changeNoticeId, options)
getChangeNoticeImpactHistory(client, companyId, decisionId)
getChangeNoticeImpactSourceAccess(client, companyId, changeNoticeId)

writeChangeNoticeImpactDecision(db, input)
  // server derives create/reassess/correction/reopen/resolve semantics
linkChangeNoticeImpactTask(db, input)
unlinkChangeNoticeImpactTask(db, input)
createChangeNoticeImpactTask(db, input)
```

Reads remain in `items.service.ts`; server-only authorization/orchestration remains
in `items.server.ts`. Multi-row writes use the database service from
`apps/erp/app/services/database.server.ts`.

### Route shape

A likely route family is:

```text
x+/items+/change-notice+/$id.impact.tsx
x+/items+/change-notice+/$id.impact.decision.tsx
x+/items+/change-notice+/$id.impact.task.tsx
x+/items+/change-notice+/$id.impact.bulk.tsx
x+/items+/change-notice+/$id.impact.history.$decisionId.tsx
```

Actions must use `assertIsPost`, `requirePermissions`, Carbon validators, flash
errors, and typed `path.to.*` helpers. The exact file split is implementation
planning, not a product promise.

## UI architecture

Use Carbon's existing `@carbon/react` primitives, `~/components/Form`, detail-page
panels, fetchers, tables, badges, and existing audit/history presentation patterns.
Do not hand-roll a second design system.

The workspace should favor:

- document group headers;
- compact target rows;
- expandable context rather than full record duplication;
- inline status/evidence badges;
- a side panel or route-addressed detail view for assessment and history;
- accessible controls with clear disabled reasons;
- tabular numeric quantities;
- existing date formatting and Carbon business-timezone helpers.

The ImpactPanel remains a summary, not the complete workflow.

## Tests

The implementation plan should include:

- service tests for candidate normalization, target deduplication, provenance derivation
  and interval reconciliation, and coverage failures;
- state-transition tests for every allowed and rejected transition;
- rationale validation tests for deterministic, ambiguous, bulk, and reassessment
  cases;
- snapshot normalization and changed-facts tests per V1 target type;
- operation-specific lifecycle tests: create/reassess/No Action/new Action Required
  require Current operational exposure, while existing Action Required resolution
  may work for Historical or No longer in current scope with closure evidence;
- Cancelled tests reject new scope/assessment/reassessment/conclusions but allow
  existing Action Required and Impact follow-up cleanup;
- transaction tests proving current decision and history commit or roll back together;
- concurrency tests for two assessors editing one row;
- task many-to-many and non-auto-resolution tests;
- post-Done engineering-lock versus Impact-lock tests;
- Restricted, Source deleted, Unavailable, and incomplete-coverage tests;
- Historical reference and No longer in current scope eligibility tests;
- source-domain redaction tests for current decisions, history, provenance, and task links;
- RLS and company-scope tests;
- route tests for Done with open Impact work and Cancelled cleanup;
- user-facing browser verification for the twenty scenarios.

# Part 3 - Assumptions / Open Validation Questions

These are manufacturer-validation assumptions, not blockers to writing or grilling
the spec. The design keeps them local so a future answer does not invalidate the
whole model.

1. Buyers generally need independent PO-line decisions rather than only a PO-header
   disposition.
2. A producing Job can be assessed at Job scope for an initial V1, while consumption
   is assessed at Job Material scope.
3. Receiving and Quality users need inspection/lot/serial semantics before a
   receipt-line Impact Decision can be trusted.
4. Manufacturers expect routine supplier and production follow-up to continue after
   engineering release without reopening the released Change Notice.
5. Manufacturers distinguish a completed/received historical reference from a
   current supplier cleanup obligation that is not represented by the PO line's
   quantity/status fields.
6. Manufacturers expect an active Job Material with fully issued material to remain
   operationally relevant while the parent Job is active.
7. Customer acceptance, Quality use-as-is, deviations, and residual-risk decisions
   should remain in their owning workflows rather than becoming generic Impact
   outcomes.

The implementation should keep target kinds, reason codes, and snapshot fields
versioned or additive so these assumptions can be refined later.

# Part 4 - Implementation Sequencing

Implementation sequencing and slice exit conditions are maintained in:

`.ai/plans/2026-08-24-change-notice-operational-impact-assessment.md`

That revised implementation plan is authoritative for engineering slice
boundaries. This product specification defines product behavior, state
semantics, security expectations, and rollout invariants rather than
duplicating the current delivery sequence.

**Public-release invariant:** decision persistence, trustworthy freshness behavior,
source-coverage correctness, and authorization must ship as a trustworthy
externally usable boundary. Users must not see a persistent green No Action workflow
while changed facts, incomplete discovery, or permission failures can look like safe
emptiness.

# Part 5 - Spec Self-Review

| Review concern | Issue found | Spec response |
|---|---|---|
| False certainty | A local No Action could be read as global safety | Target-local language, explicit context-only section, separate counts |
| Checkbox bureaucracy | Gating Done or requiring prose for deterministic evidence would encourage rubber-stamping | No release gate; conditional rationale rules; Carbon facts count as evidence |
| Duplicate workflow | Accepted Exposure, NCR, inspection, and customer acceptance have overlapping meanings | Removed generic states; link to authoritative workflows |
| Invalid state combinations | Separate conclusion and resolution fields allow contradictory combinations | One persistent decision-status axis |
| Stale decisions | Current source facts can change after an assessment | Normalized snapshots, changed-facts comparison, explicit reassessment |
| Incomplete discovery | `getPartUsedIn()` is capped, item-fanned out, and can hide errors as empty results | Dedicated set-based candidate service with coverage/error semantics |
| Historical references become checkbox work | Every where-used row could become New / Unassessed | Domain-specific Current operational exposure eligibility and a separate Historical references section |
| Permission leaks | Missing source permission could look like no impact or expose copied Impact evidence | Restricted source handling, source-read prerequisite, and redacted current/history/provenance/link DTOs; ordinary task text remains under existing task permissions |
| Post-Done contradiction | Current workflow lock freezes action tasks at Done | Separate engineering and Impact operational lock scopes; explicit task origin and UI copy |
| Target granularity | PO and Job parent decisions could hide line/material exceptions | PO line, Job, and Job Material target identity with document grouping |
| History loss | Generic audit is optional, asynchronous, and retention-limited | Feature-owned append-only reassessment, task-link, and provenance history |
| Scope changes | Removing an affected item or changing a source item could delete context or infer closure | Current versus historical provenance, No longer in current scope, and no automatic conclusion change |
| Direct first resolution | Users could be forced through fake Action Required state | New / Unassessed -> Resolved with mandatory closure evidence |
| Canonical evidence drift | Same target type could use ad hoc snapshot fields | Deterministic `*_SNAPSHOT_V1` contracts and stable comparison semantics |
| Cancelled cleanup | A global Cancelled lock could strand reversal communication | Existing Impact-origin cleanup remains completable; new scope/reassessment stops |
| Scope creep | Inventory, receipts, Quality, sales, and PLM could become partial workflows | Three full V1 domains, context-only boundaries, explicit non-goals |
| Excessive architecture | A generic target engine or risk framework would exceed the workflow | Three constrained target kinds, one current table, provenance/task joins, one history table |
| Task confusion | A shared task might be mistaken for shared resolution | Many-to-many linkage with one task status and explicit per-decision resolution |
| Cancellation ambiguity | Cancelled and Done do not have the same engineering meaning | Cancelled stops new scope but permits existing Impact cleanup; existing reopen path is preserved |
| Parent deletion | A permanent undeletable parent would silently change Carbon lifecycle | Feature history is durable while the parent exists; existing explicit parent deletion semantics remain |
| Manufacturer assumptions | Exact operational habits may vary | Assumptions are isolated in Part 3 and do not change the core target/history model |

This specification is ready for grilling and implementation planning. It does not
authorize implementation, migration creation, or changes to Carbon code.