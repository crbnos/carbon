# Projects Workspace Research: Systems Engineering Model and Work-Item UI

> Research date: 2026-10-07. Input to `.ai/specs/2026-10-03-projects.md` (*The project workspace*, *UI Changes*). Companion to `.ai/research/projects-wbs-pmmo.md`, which covers project cost, stock and billing.

## Summary

This research covers two products. **Flow Engineering** is a requirements and systems engineering tool for hardware teams. **Plane** is an open-source alternative to Jira and Linear.

The questions were how a project can hold requirements and systems design, and how its UI should look. The research does not cover cost or time, because neither product tracks them.

The findings:
- **Flow** models a project as a graph of typed items: systems, requirements, functions, test cases, parameters and folders. One parent link carries roll-ups. Typed cross-links carry trace relations. Parameters with units feed target checks that give pass or fail. Branches and change reviews control edits.
- **Plane**'s primitive is the work item. A work item has a state (in five fixed groups), an owner, a priority, labels, dates, a parent and relations. It shows as a list, a board, a spreadsheet, a calendar or a Gantt chart, with a dense, pill-based UI.
- **Neither product tracks cost, schedule actuals or time.** Flow hands execution to Jira and Linear. Plane's community edition has no time tracking, work-item types or custom properties; all three are paid features.

That gap is Carbon's place: the same elements carry charge numbers, time, materials, budgets and billing.

## Competitors Surveyed

- **Flow Engineering** (flowengineering.com): "requirements tool for agentic teams". Customers include Rivian (1M+ requirements), Anduril, Astranis, Stoke, Joby and Skydio.
  - **V2** has fixed item types.
  - **V3** (June 2026) is a generic typed graph with git-style branches. The user's screenshots show V3.
- **Plane** (`~/Code/plane`, commit `66c95bd3f3`): an open-source (AGPL-3.0) work-item tracker modeled on Linear and Jira. Its web app uses React Router, Vite, MobX and Tailwind v4, which is close to Carbon's stack.

## Key Consensus Patterns

### 1. A typed node with one parent and many cross-links

- **Flow**:
  - V2 has fixed types (Requirement, System, Design Value, Test Case, Document).
  - In V3 an organization defines *categories*, each with a name, an id prefix (`REQ-12`) and fields.
  - V2 states the rule: the parent link "rolls up", and a cross-link is lateral.
- **Plane**:
  - A work item has one `parent` (unlimited depth) and typed relations in reverse pairs: `blocked_by` ↔ `blocking`, `relates_to`, `duplicate`, `start_before` ↔ `start_after`, `finish_before` ↔ `finish_after`, `implemented_by` ↔ `implements`.
  - Work-item types (`IssueType`) exist in the schema but are paid.
- **Rationale.** One parent path makes roll-ups count each value once. Cross-links show trace relations without breaking the roll-up.

### 2. Workflow state in fixed groups

- **Plane:**
  - A project defines its own states.
  - Each state belongs to a group: backlog, unstarted, started, completed, cancelled (plus triage).
  - The group drives behavior. For example, `completed_at` is set when the item enters the completed group.
- **Flow:** a `stage` field with review rules, approvals and lock state.
- **Rationale.** Teams name their own states. The system reasons only about the group.

### 3. Values with units, targets and roll-ups

- **Flow V2:**
  - A Requirement holds a target, either a number or a range with an open end ("≥ 5").
  - A Design Value is a number, a range, or an aggregation (sum, product, mean, min, max).
  - A Target check compares the two and gives pass or fail.
  - A Summary check passes only when all child requirements pass.
- **Flow V3:**
  - Formulas on any field, with roll-ups and `min` / `max`.
  - Units on number fields (October 2026). Roll-ups compute on the bare number.
- **The screenshots** show an allocation: "≤ 600 kg (30.0 % of 2,000 kg)".
- **Rationale.** Engineering budgets (mass, power) are values that roll up a system tree and compare with requirements.

### 4. Verification links tests to requirements

- **Flow:** a Test Case holds ordered steps and runs, and each step result is Pass, Fail, Skip or Pending. A `verificationResult` field holds Pass, Fail or Inconclusive.
  - Verification methods link tests, documents and values to a requirement.
  - When a linked item changes, the "suspect" workflow flags the dependent items.
- **Plane:** none.
- **Rationale.** A requirement is done when its checks pass, not when someone closes it.

### 5. Several layouts over one dataset

- **Flow:** Table (a spreadsheet with formulas), Tree (a graph of item cards), Reader (a document with PDF and Word export), Architecture (nested systems).
- **Plane:**
  - Layouts: List (the default, with inline children), Kanban, Spreadsheet, Calendar, Gantt.
  - A **Display** menu: group by, sub-group by, order by, shown properties, show sub-items, show empty groups.
  - A **filter row** of property · operator · value chips, which can be saved as a view.
  - Each user's display settings persist per project (`ProjectUserProperty`).
- **Rationale.** Engineers, managers and reviewers need different shapes of the same items.

### 6. Change control for the plan

- **Flow V3:**
  - Branches from "Base", nested, with variants (SUV, 2026, 2027).
  - Protected branches.
  - Change requests with per-property diffs, comments on the changed field, "viewed" marks, required reviewers ("any" or "all"), stage gates and merges.
  - Every merge writes a baseline snapshot, and any two baselines can be compared.
- **Plane:** an activity log per item (`IssueActivity`) and versions of the description.
- **Rationale.** A requirement or budget change needs review before it reaches the baseline.

## Answers to Research Questions

1. **How can a project hold requirements and systems design?**
   - As typed elements in one tree: System, Requirement, Function, Task, Test Case, Parameter and Folder.
   - Trace links connect them (satisfies, verifies, derives, implements).
   - Parameters with targets give a computed verification status.

   This is Flow's model with a fixed type set. Carbon elements are FK targets for charges, so the code must know their types.
2. **Can time and materials go straight to these elements?**
   - Neither product supports it, so Carbon designs it.
   - Every element can be a charge number, and its page has **Log time** and **Issue material**.
   - Roll-ups of cost and hours follow the same parent path as Parameter roll-ups.
3. **What should the UI look like?** Plane's patterns, translated into Carbon's design system:
   - Dense rows of 44 px and property pills of 20 px.
   - One picker component in three variants: pill, ghost select and table cell.
   - A side peek at 50 % width, the Display menu, the filter row, quick-add rows and `cmd+k`.
   - Flow adds the Tree and Reader layouts.
4. **Should Carbon copy Flow's branching?**
   - Only for the plan layer: elements, links, parameters, budgets and plan lines.
   - Time entries, issues and journals are facts and cannot merge.
   - Variants are product configuration, which Carbon keeps in items, revisions and make methods.
   - Baselines and change requests give most of the value. Carbon's change notice already has a merge base (`changeOrderAffectedItem.baseMakeMethodId`) and a field diff engine (`diffRows`).

## Competitor-Specific Details

### Flow Engineering

- **Field types (V3):** text, rich text, number (with a unit), tag, date, toggle, user, verification result, diagram, Jira, Linear, Google Doc, Google Sheet, CAD file, file, stage.
- **Formulas:** start with `=`. `get_cell` reads Excel or Google Sheets cells and refreshes every 5 minutes. In-app Python can read and write a branch.
- **Live V&V:** Onshape masses and lengths, Excel cells, and Epsilon3 and Qase test runs feed values and verdicts automatically.
- **Agents:** impact analysis; mass, cost and power budgets; compliance. Agents work on branches. "Nothing an agent does reaches the baseline on its own."
- **Boltline integration:** reads engineering BOMs, as-built trees and work plans, and writes work plan templates. This is the closest Flow comes to manufacturing.
- **Pricing:** $150 or $300 per editor per month.
- **Not covered:** project management, cost, schedule and time.

### Plane

- **Data model:**
  - `Issue`: `name`, `description_html`, `priority` (urgent / high / medium / low / none), `state`, `assignees`, `labels`, `parent`, `estimate_point`, `start_date`, `target_date`, `sequence_id`, `sort_order`, `completed_at`.
  - `Cycle`: a time box with progress snapshots.
  - `Module`: a many-to-many grouping with a lead and a status.
  - `Label`: two levels.
  - `IssueView`: saved filters and display settings.
  - `Page`: documents.
  - `Intake`: triage.
- **Ids:** a project `identifier` (up to 12 characters) plus a per-project sequence (`PROJ-123`), allocated under an advisory lock. An item keeps its id when it moves.
- **Visual language:**
  - Tokens: surface and layer tokens (`bg-canvas`, `bg-surface-1/2`, `bg-layer-1/2/3`), text tokens (`text-primary` … `text-tertiary`), border tokens (`border-subtle`, `border-strong`).
  - Type: Inter at 11 to 13 px.
  - State icons: a dashed circle (backlog), a hollow circle (unstarted), a partly filled ring (started), a check (completed), a cross (cancelled).
- **Detail page:** parent pill, id, title, rich description and action buttons. Below them come collapsible sections: Sub-work items (with a progress ring and "3/7 Done"), Relations (grouped by type), Links and Attachments. The Activity feed ends the page. The properties sidebar has a fixed label column of 120 px with ghost selects.
- **Cycles page:** Active, Upcoming and Completed groups. Each row has a circular progress ring. A burndown chart plots current progress against a dashed ideal line.
- **Keyboard:**
  - `cmd+k` opens the palette.
  - `n*` and `g*` sequences create and go to items.
  - `s`, `p`, `a` and `l` set the state, priority, assignee and labels.
- **Paid features** (not in the community edition): work-item types, custom properties, epics, initiatives, time tracking and worklogs, and Gantt dependencies.

## Recommended Approach for Carbon

1. **One `projectElement` table with a fixed type set.**
   - Types: Folder, System, Requirement, Function, Task, Test Case, Parameter.
   - Custom fields come from `customField`. The type-specific columns are nullable.
   - Follows Flow V2's types and Plane's single work-item table.
2. **Readable ids from the project identifier plus a sequence** (`SNS-12`), stable when the element moves. This follows Plane.
3. **Per-project states in five fixed groups.** The group gates charging, and the first charge starts an Unstarted element. This follows Plane.
4. **Trace links in a separate table, with reverse labels.** Only the parent link rolls up. A link turns suspect when the element at its far end changes. This follows Flow V2 and Plane's relation pairs.
5. **Parameters and requirement targets, without a formula language.**
   - A Parameter is Manual or a roll-up (Sum, Min, Max).
   - A Parameter can be an allocation % of its parent.
   - Units are free text with no conversion.
   - Follows Flow V2's Design Values and Target check.
6. **Test Case verdicts and an optional link to a Carbon quality procedure** (`qualityDocument`). This connects verification to the existing quality module.
7. **Six layouts:** List, Board, Table, Tree, Timeline and Reader. Plane gives the first three and the Timeline; Flow gives Tree and Reader. Calendar is left out.
8. **Plane's interaction model and density**, built with Carbon's design system: pills that are also editors, the side peek, the Display menu, the filter row, quick-add, keyboard shortcuts and saved views.
9. **Milestones in place of cycles**, for design reviews (SRR, PDR, CDR), phases or sprints. Each shows a progress ring and a burn chart, and Phase 4 can bill on it.
10. **Baselines and change requests for the plan layer only.**
    - They reuse the change notice diff engine and the approvals engine.
    - Branching stays out of actuals and out of variants.
11. **Copy patterns, not code.** Plane is AGPL-3.0, and Carbon's `packages/ee` is under a commercial license.

## Sources

Flow Engineering
- https://www.flowengineering.com/
- https://www.flowengineering.com/product/systems-graph
- https://www.flowengineering.com/product/requirements-management
- https://www.flowengineering.com/product/branching
- https://www.flowengineering.com/product/agents
- https://www.flowengineering.com/integrations
- https://www.flowengineering.com/integrations/onshape
- https://www.flowengineering.com/customers
- https://www.flowengineering.com/pricing
- https://www.flowengineering.com/blog/agents-have-reached-hardware
- https://www.flowengineering.com/blog/inside-spacex-bill-of-design
- https://www.flowengineering.com/blog/rivian
- https://docs.flowengineering.com/llms.txt
- https://docs.flowengineering.com/release-notes
- https://docs.flowengineering.com/release-notes/2026-10-06.md
- https://docs.flowengineering.com/release-notes/2026-10-02.md
- https://docs.flowengineering.com/release-notes/2026-09-18.md
- https://docs.flowengineering.com/release-notes/2026-09-11.md
- https://docs.flowengineering.com/api/endpoints/post-project-projectid-data-model.md
- https://docs.flowengineering.com/api/endpoints/post-project-projectid-entities-entityid-crosslinks.md
- https://docs.flowengineering.com/api/endpoints/post-project-projectid-branch-id-merge.md
- https://docs.flowengineering.com/api/endpoints/post-project-projectid-branch-id-set-review.md
- https://docs.flowengineering.com/api/endpoints/get-project-projectid-branch-id-stage-gate-status.md
- https://flow-engineering-knowledge-base.help.usepylon.com/articles/3726859998-understanding-data-types-in-flow
- https://flow-engineering-knowledge-base.help.usepylon.com/articles/6959463456-roll-ups
- https://flow-engineering-knowledge-base.help.usepylon.com/articles/1241358509-suspect-workflow-video
- https://flow-engineering.productlane.com/changelog/2026-01-06-verification-methods-2-0
- https://research.contrary.com/company/flow-engineering

Plane (local source, `~/Code/plane`)
- `apps/api/plane/db/models/{issue,state,label,cycle,module,estimate,view,project}.py`
- `packages/constants/src/issue/{common,layout,filter}.ts`, `packages/constants/src/estimates.ts`
- `apps/web/components/issues/issue-layouts/{list,kanban,spreadsheet,calendar,gantt}/*`
- `apps/web/components/issues/peek-overview/*`, `apps/web/components/issues/issue-detail/*`, `apps/web/components/issues/issue-detail-widgets/*`
- `apps/web/components/cycles/*`, `apps/web/components/core/sidebar/progress-chart.tsx`
- `apps/web/components/power-k/*`
- `packages/blocks/src/{pill-button,property-select,select,icons/state}/*`, `packages/tailwind-config/AGENTS.md`
- `apps/web/components/workspace/billing/comparison/plans.tsx` (the paid feature list)
