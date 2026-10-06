# Change Notice Impact workspace

Last tested: 2026-09-16 (Slice 6D Cancelled lifecycle browser acceptance — partial)
Route: `/x/items/change-notice/:id/impact`

## Prerequisites
- Local Carbon ERP dev server is running.
- The seeded company has at least one Change Notice with affected items and supported production or purchasing records.

> Slice 5D browser note: seeded CN-000001, CN-000002, and CN-000003 all reported complete task coverage. The incomplete task/candidate coverage warning path is covered by automated tests, but was not available in the seeded browser data.

## Steps
### 1. Navigate
Open Items → Change Notices and open a Change Notice, then select **Open Impact workspace**. The page should show the Operational Impact heading, engineering status, coverage cards, and current/historical sections.

### 2. Verify read-only exposure
Confirm supported rows are grouped by readable PO/Job, producing Job and Job Material rows are distinct, current rows show source facts and an **Open source** link, the **Informational context only** notice is visible instead of legacy mixed-domain rows. Verify decision controls appear according to assessment eligibility. Use the **Search** and **Filter** controls to narrow rows without changing the authoritative coverage cards.

### 3. Verify search and filters
Search a PO readable ID, producing Job readable ID, item/revision label, and supplier name. Confirm search is case-insensitive and trimmed. Apply Domain, Exposure, Decision, Freshness, Availability, Task status, and Assignee filters; select multiple values in one dimension to confirm OR behavior and combine dimensions to confirm AND behavior. Confirm filtered child rows keep their document group, nonmatching siblings disappear, and empty groups are not shown. Use browser back/forward and **Clear Filters** to confirm the URL-backed state restores and clears correctly. If linked-task coverage is incomplete, confirm task/assignee filtering shows the bounded metadata warning rather than implying missing tasks are absent.

### 4. Verify refresh and navigation
With search or filters active, select **Refresh** and confirm the workspace data reloads without clearing the URL state. Select **Open source** on a supported row and confirm it navigates to the corresponding source detail, then return to the workspace.

### 5. Verify layout
Scroll the content pane through the full workspace. Confirm the content scrolls vertically without horizontal overflow and the browser console has no errors.

### 6. Verify Impact task controls
On a Done or Cancelled Change Notice with an existing Action required Impact decision, open the Impact workspace and confirm **Create follow-up** is visible. Open it and verify the form contains task name, assignee, due date, and notes fields, but no first-assessment rationale; cancel without submitting. On an unassessed row, including an unassessed Cancelled row, confirm **Create follow-up** is not shown.

### 7. Verify lazy Impact history
On a row with an existing Impact decision, confirm **History** is visible. Open it and verify the drawer shows the current conclusion and source facts before the event timeline. Confirm the browser requests one decision-specific `/impact/history/<decisionId>` resource only after opening the drawer. Verify assessment events show conclusion changes, rationale, resolution notes, and expandable snapshots; task events show the task label or a details-unavailable fallback; provenance events show the affected-item label. Close the drawer and confirm the workspace remains usable.

### 8. Verify Slice 5E bulk Impact selection
On a Change Notice with at least two eligible current production targets, select rows individually and confirm the count, **Review selected**, and **Clear selection** controls. There is no Select All or Clear Visible control. Open **Review selected** and verify each target's domain/identity, current conclusion, and snapshot facts are listed; confirm the available conclusion options are the intersection of the selected targets' valid operations. Choose the shared conclusion, enter the review rationale, and click the visible **Apply to <count>** button. Verify exactly one bulk POST, one workspace revalidation, the expected success/no-op message, cleared selection, and a closed drawer. Re-submit the same conclusion and rationale to verify the no-op state and that History has no new event. Search and refresh should preserve or reconcile the selection without writing.

Slice 5E browser coverage on seeded data did not include PO targets, Changed-since facts, or a clean stale-preview conflict fixture. Those paths remain covered by focused tests until safe fixtures exist.

## Slice 6D core exposure PASSes

### Scenario 7 — task completion does not resolve — PASS
- Fixture: CN-000001 / BAT-LIION-48V / PO000001 Purchase Order Line; decision `Action required`; follow-up `Review affected battery PO line`.
- The follow-up was completed through the normal Carbon task UI; the task became `Completed` and the UI offered `Reopen`.
- The Impact decision remained `Action required` after completion and Refresh. The PO remained `To Receive`, `6 EA` ordered, `0 EA` received, `6 EA` remaining, supplier `PropTech Solutions`. History retained assessment/task-related evidence; no distinct task-completion Impact history event is claimed.
- Proven invariant: task completion != decision resolution.

### Scenario 11 — Action required → No action required correction — PASS
- Fixture: CN-000003 / BUS-STR-001 / Producing Job J000003.
- Through the normal Reassess flow, `Action required` changed to `No action required`. At the time of correction, the Job was `Planned`: `1 EA` planned, `0 EA` completed, `1 EA` remaining, due **May 27, 2026**, method `V1`.
- Refresh preserved `No action required`; History showed `CONCLUSION CORRECTED`; the source Job remained unchanged. The later Changed-since run that changed the due date May 27 → May 28 is separate evidence, not the correction-time value.

### Producing Job — PASS
- Fixture: CN-000003 / BUS-STR-001 / J000003 (Planned, initially Unassessed).
- From the Impact workspace, use the **Assess** control on the **Producing Job** row.
- The modal shows the producing-job facts (planned, completed, remaining, due, job status, shipped, received to inventory, method) and the conclusion/rationale fields.
- Save **Action required** with a written follow-up rationale through the modal's own form using native `requestSubmit`.
- Verify the row changes to **Action required**, then use **Refresh** and **History**. The refreshed row preserves the conclusion and facts; history shows `ASSESSMENT CREATED` with the conclusion, rationale, and snapshot. No task is required for this PASS.

### Job Material — PASS
- Fixture: CN-000003 / BUS-STR-001 / J000001 Job Material `jmat_AfETWw6mnfJ5F82FFTkwwY` (In Progress, existing Action required decision).
- Use **Reassess** on the matching **Job Material** row; edit the rationale and save **Action required** with the modal's **Save reassessment** submitter.
- Verify the row remains an independent Job Material target with required, issued, remaining, job status, method type, and tracking facts. Use **Refresh** and **History**; the new `ASSESSMENT REASSESSED` event contains the conclusion, rationale, and snapshot.
- Existing linked tasks do not resolve the Action required decision; do not create or complete a task during this flow.

### Purchase Order Line — PASS
- Fixture strategy: Route B. Existing `PO000001` was a safe open PO, so the normal **Add Affected Item** flow on Draft `CN-000001` added `BAT-LIION-48V` as a `Revision` (creating `BAT-LIION-48V.1`). No PO source fields were edited.
- Source baseline: `PO000001`, line `MGkuFZuByvti2YP6xoLfxo`, supplier `PropTech Solutions`, status `To Receive`, ordered `6 EA`, received `0 EA`, remaining `6 EA`, conversion `1 EA → EA`, receipt complete `No`.
- After returning to **Open Impact workspace**, select **Refresh**. The line appears under **Current operational exposure** as `Purchase Order line`, with the PO readable ID, supplier, item, ordered/received/remaining quantities, PO status, conversion, and receipt-complete facts. A second independent line (`PO000004`, `WwAyHToQCZ9aErkxKHoDkZ`, `25 EA` remaining, `To Receive and Invoice`) also appears naturally.
- Use the first line's **Assess** control, keep **Action required**, enter a written rationale, and submit the modal's own form with native `requestSubmit` and its **Save assessment** submitter. The row changes to **Action required**.
- **Refresh** preserves the conclusion and facts. **History** shows the current conclusion/source facts, `ASSESSMENT CREATED`, the rationale, an expandable captured snapshot, and the linked follow-up event.
- **Create follow-up** is available after assessment. Create `Review affected battery PO line`, assign the seeded `Test` employee, and add notes. The task remains linked after Refresh and the decision remains **Action required**. Do not complete the task.
- Opening **Open source** shows the normal PO detail (`PO000001`, `To Receive`, `BAT-LIION-48V`, `6 EA`); read-only source inspection after the assessment/task still showed status `To Receive`, ordered `6`, received `0`, remaining `6`, supplier unchanged.
- Multiple-target check: after assessing only `PO000001`, `PO000004` remained a separate `UNASSESSED` `Purchase Order line` with its own line identity and source facts.

### Action required → Resolved: PASS
- Fixture: CN-000001 / BAT-LIION-48V / PO000001 line `MGkuFZuByvti2YP6xoLfxo`.
- Original rationale: `Open PO line requires procurement review before the affected battery revision is released.`
- Actual intervention: the existing Impact follow-up `Review affected battery PO line` had already been completed through the normal Carbon task workflow. It was assigned to Test, carried notes `Review the open BAT-LIION-48V purchase order line before implementation.`, and persisted as `Completed` with a completion date. The rationale required a procurement review only; it did not require receiving, supplier contact, a PO edit, a quantity change, or another source mutation. The completed task therefore records the required intervention without pretending that the PO itself was changed.
- Pre-resolution state: the row was in current operational exposure with conclusion `Action required`. The PO was `To Receive`, ordered `6 EA`, received `0 EA`, remaining `6 EA`, conversion `1 EA → EA`, receipt complete `No`, supplier `PropTech Solutions`. No `Changed since assessment` state was shown.
- In this session, the row's dedicated `Resolve` action exposed `Closure evidence`. The truthful note entered was `Completed the Impact follow-up review of the open BAT-LIION-48V line before implementation; no further operational action is required for this Impact decision.`
- Save showed `Resolved` immediately. `Refresh` kept the row `Resolved` with the same source facts and resolution note.
- History showed `ASSESSMENT RESOLVED` (`Decision resolved`) with previous `Action required`, new `Resolved`, the resolution note, and a before/after assessment snapshot. Earlier `TASK LINKED`, `ASSESSMENT CREATED`, and `PROVENANCE STARTED` events remained. The linked task remained `Completed`, separate from the decision transition.
- Source integrity: the normal PO detail and a read-only database check still showed PO000001 `To Receive`, BAT-LIION-48V, ordered `6`, received `0`, remaining `6`, and supplier `PropTech Solutions`. Impact resolution changed no PO fields.

### Fixture gap observed before this fixture setup
- Before adding the Route B fixture, CN-000001, CN-000002, and CN-000003 exposed no Purchase Order Impact rows. Do not treat the existing seeded CN data as PO coverage without this ordinary affected-item setup.
- No safe/simple completed PO existed for the affected item. The available open battery line is Batch-tracked, so completing it would require tracked-entity receiving setup; historical coverage remains pending rather than manufacturing a receiving fixture.

### Changed since assessment — PASS
- Fixture: CN-000003 / BUS-STR-001 / Producing Job J000003. It started current with **No action required**. The existing correction snapshot captured Due as **May 27, 2026**.
- Safe source field: the Job **Due Date**. It was present in the Impact snapshot and editable in the normal Job properties UI. Open the target's **Open source** link, open the Due Date calendar, and select the next nearby date. This run changed **May 27, 2026 → May 28, 2026** exactly once.
- Source integrity before and after: Planned status, planned quantity `1 EA`, completed `0 EA`, remaining `1 EA`, shipped `0 EA`, received to inventory `0 EA`, and method `V1` were unchanged.
- Return to Impact and select **Refresh** before reassessing. The conclusion stayed **No action required** while the row showed **Changed since assessment**. The current Due fact was May 28, while the expandable assessment snapshot still showed May 27. History retained the existing assessment and correction events; the Job edit did not create an assessment or reassessment event.
- **Reassess** showed the current May 28 source fact. Submit **No action required** with the rationale `Re-reviewed after the source job changed; no operational follow-up is required.` A later **Refresh** cleared **Changed since assessment**. The new `ASSESSMENT REASSESSED` event kept the same conclusion, stored the new rationale, captured May 28 in its snapshot, and preserved earlier history.

### Done lifecycle operational follow-up — PASS
- Fixture: CN-000003 (`co_56YjJRNVPQXnyJEw2vE6FQ`) / BUS-STR-001; it was already `Done` before this session. The existing `Job Material` target was J000001 / `jmat_AfETWw6mnfJ5F82FFTkwwY`, with `Action required` and an existing linked `Slice 5B browser QA follow-up` task (`Impact follow-up`, `In Progress`, assigned to Test).
- Engineering lock observed without attempting an engineering mutation: Change Notice properties `Edit` was disabled, engineering fields were read-only, and the **More options** menu had no Reopen-from-Done action.
- The Impact workspace loaded and showed `Done · Engineering released. Operational assessment remains available.` The current Action required decision, source facts, and History remained readable. History retained the assessment, provenance, reassessment, and task-link events.
- Maintained the existing Impact follow-up through its normal editable notes control; the task remained open, assigned to Test, and available for completion. No new task was created and the task was not completed.
- The Change Notice stayed `Done`; the decision stayed `Action required`; follow-up activity did not resolve the decision or alter engineering status. Refresh and a full page reload preserved the decision, task, and edited notes.
- Read-only source verification after the workflow still showed J000001 `In Progress`, BUS-STR-001, required `3 EA`, issued `0 EA`, remaining `3 EA`, `Make to Order`, and no batch/serial tracking. No source mutation occurred.

### Cancelled lifecycle — PARTIAL
- Fixture: CN-000002 (`co_4VhTqQ3YQeAXSDdMX1U6S6`) / EPS-001; it was already `Cancelled`. The Impact workspace remained accessible and showed the existing J000001 Job Material decision as `Action required`, with source facts and History available.
- Engineering lock observed without mutation: `Edit` and engineering fields were disabled/read-only. The More options menu exposed `Reopen`; it was not used because this fixture contains useful Impact state.
- Existing linked `Impact follow-up` `Slice 5B cancelled cleanup QA` was maintained through its normal notes editor. After Refresh it remained linked, `Pending`, and `Impact follow-up`; the Change Notice remained `Cancelled`, the decision remained `Action required`, and read-only source facts were unchanged. No automatic resolution or lifecycle mutation occurred.
- The row exposed cleanup controls (`Create follow-up`, `Link task`, `Unlink task`, editable task notes/status controls) but no ordinary `Reassess`; `Resolve` was disabled while the linked task remained pending. History remained readable. No Template-owned or ordinary Manual task existed on this fixture.
- Read-only discovery found J000002 Job Material (`Ready`) with no decision, but the Cancelled workspace reported Job Materials `Unassessed 0` and rendered no row or `Assess`/unassessed follow-up control. First-assessment blocking was not directly browser-verified; no new source exposure was created for new-discovery proof.
- Reopen was intentionally skipped. Final fixture state remains `Cancelled`.

## Selector Notes
- Navigate through visible labels rather than cached accessibility refs.
- Use the **Open Impact workspace**, **Refresh**, **Open source**, **History**, and **Reassess** link/button names.
- The Job Due Date control is identified by its field label and calendar button, not a cached accessibility ref. Submit the reassessment modal with its own native `requestSubmit` form flow.
- Coverage warnings and restricted/partial behavior are best verified with the focused service tests when the seeded browser user has full source access.

## Common Failures
- Login may take several seconds while the local Turnstile bypass initializes; wait before submitting the email form.
- A seeded Change Notice may have no historical rows; use the focused Impact tests for historical/source-coverage edge cases.
