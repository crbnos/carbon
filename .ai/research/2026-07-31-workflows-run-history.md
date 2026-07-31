# Workflows — Run History and Observability: Research

> Date: 2026-07-31
> For: phase 9 of the workflows programme (`/Users/aashu/work/carbon/plans/automations-engine/phases/phase-9-run-history.md`)
> Sources: Zapier, n8n, Make.com, Temporal, AWS Step Functions, Apache Airflow, Inngest,
> Trigger.dev, Sentry, Datadog, Elastic APM, Rails, OpenTelemetry, OWASP, Stripe, OMB M-21-31.
> Every claim below is cited with a URL in the per-product sections that follow.

## What the research settles

**1. The ordered step list is the debugging surface; the canvas is orientation.**
Step Functions ships graph + table + event views with cross-selection and treats the
*filterable ordered list* as the documented debugging path. Airflow's grid is a list. n8n and
Make instead overlay the canvas — and n8n's overlay is the reason it cannot show history for a
workflow whose definition has since changed. Since Carbon already freezes a
`workflowVersionId` per run, an ordered list rendered against the frozen definition is both
cheaper and more correct than an overlay. Overlay is a later addition, not the v1 surface.

**2. "Why did nothing happen" is answered by materialising the steps that did *not* run.**
Airflow's 14-state task vocabulary separates `skipped` (a branch was not taken, rendered
purple) from `upstream_failed` (prevented by an earlier failure, rendered **orange, not red**)
from `none` (never reached) and `removed` (the definition changed mid-run). Zapier, by
contrast, half-surfaces the filter reason — a yellow `!` and a literal `(missing value)`
token, with no per-clause evaluation — and this is the single loudest complaint about Zapier's
history. The clearest place to beat both is a per-clause evaluation table on a condition node
plus an explicit, greyed "not reached" row for every node in the frozen definition that has no
step row.

**3. Statuses must be one vocabulary, decided once.** n8n stores 8 execution states but only
lets you filter on 4 — the divergence is a documented usability wart. Zapier collapses a
two-level vocabulary (run and step share status names) into one badge per run, which works.
Carbon's DB CHECKs already fix the vocabulary: runs are
`Queued | Running | Succeeded | Failed | Blocked | Skipped`, steps are
`Running | Succeeded | Failed | Skipped`. The filter set must be exactly the stored set.

**4. Item counts on the wire are the best idea in either no-code product.** Make puts a
bundle-count bubble on every connector, so drop-off between a lookup that returned 40 and a
filter that passed 3 is visible without opening anything. In Carbon this maps to a count on the
list-producing nodes (lookup, filter, batch aggregate) shown in the step row.

**5. Parent/child links belong on the run *and* on the step that caused it.** Temporal's
Relationships tab models four kinds — Parent, Children, Next, Previous — and previews a child
inline. Inngest's `step.invoke` carries the triggered run id on the step. Step Functions'
opt-in `AWS_STEP_FUNCTIONS_STARTED_BY_EXECUTION_ID` is the anti-pattern: linkage must be
automatic and server-side. Carbon already writes `causedByRunId` / `rootRunId` / `path`
server-side, so both directions ("what caused this" and "what did this cause") are one indexed
query each.

**6. Live view is polling in every serious engine, not push.** Airflow auto-refreshes at 3s
with a user toggle, Temporal batches at 2s. Nobody uses websockets for run history. The real
bug to avoid is Airflow #23542, where auto-refresh reordered grid rows under the user's cursor:
stable keys and stable ordering are mandatory, and refresh must stop at a terminal state.
Carbon already has Supabase realtime on both tables plus a `useDebouncedRealtime` hook, which
is strictly better than polling as long as the debounce is real and the subscription stops when
the run finishes.

**7. Per-step live progress is a write-amplification decision, not a UI one.** n8n's
`EXECUTIONS_DATA_SAVE_ON_PROGRESS` — the setting that makes a running execution visible
step-by-step — defaults **off** for exactly this reason. Carbon's engine already writes a
`Running` row per step at claim time, so it pays this cost already and gets the live view for
free.

**8. Redaction: keep the key, replace the value.** Every published scrubber (Sentry, Rails,
Elastic APM, OpenTelemetry) matches key names **case-insensitively**, most match on substring
or anchored wildcard, and the spec rule is to preserve the key and substitute `[REDACTED]` — a
dropped key is indistinguishable from a field that was genuinely absent, which is the exact
question a run log exists to answer. Real lists: Sentry Python's 30-entry `DEFAULT_DENYLIST`,
Rails' `[:passw, :email, :secret, :token, :_key, :crypt, :salt, :certificate, :otp, :ssn,
:cvv, :cvc]`, Elastic APM's `password, *key, *token*, *session*, *credit*, *card*, *auth*,
set-cookie, *principal*`. Carbon's current `redactForLog` drops the key and is applied to
`input` only — both are gaps this phase should close.

**9. Outbound webhooks: never store the request headers or the response body.** OWASP's
webhook cheat sheet forbids logging full request bodies, signing secrets and raw
`Authorization` headers, and names the safe set: timestamp, method, response status, event
id/type, latency. A response body is third-party-controlled, unbounded, frequently echoes the
request including its auth, and turns an SSRF into a persisted read primitive. GitHub does
store bodies but compensates with a 3-day window. Carbon's engine already keeps a 2 KB excerpt
— that is the compromise, and it must stay an excerpt.

**10. Three-tier retention is standard practice, not an invention.** Stripe: full detail 30
days → summary 13 months → gone. OMB M-21-31 mandates tiered hot/cold windows for federal
logging. n8n prunes on both age (`EXECUTIONS_DATA_MAX_AGE`, 336h = 14 days) and count
(`PRUNE_MAX_COUNT`, 10k), with a two-phase soft-then-hard delete, never prunes `new`/`running`/
`waiting`, and never prunes an execution the user annotated. Carbon's chosen 7 / 30 / 90 sits
inside the industry band. Two n8n behaviours worth stealing: a **count cap** alongside the age
cap so one runaway tenant cannot outgrow the table, and **never purging a non-terminal run**
(which the technical-decisions doc already requires for a different reason — the step rows are
the idempotency ledger).

**11. Truncation needs a marker, and there is a conventional one.** Node's `util.inspect`
produces `... N more items` and `... N more characters` (defaults 100 items / 10 000
characters). OpenTelemetry truncates with *no* marker, which is an anti-pattern for a debugging
UI — a silently-shortened value reads as a complete one. Order of operations must be redact →
truncate → byte-budget.

**12. Storing an entity as `{type, id}` rather than a row snapshot is the correct privacy
design**, not just a size optimisation: it satisfies GDPR Art. 5(1)(c) data minimisation, makes
erasure and rectification propagate from the source row instead of requiring a fan-out rewrite
of every historical run, keeps the log accurate over time, and forces every read back through
RLS and `companyId`. Carbon's runtime already does this.

**13. Replay is a whole feature, and every product that has it made it a separate run.**
Zapier's replay creates a new immutable run linked to the original, has a 60-day window,
requires the Zap to be on, and — importantly — **never re-evaluates Filter/Path steps**.
Make's Incomplete Executions queue is a durable, resumable work queue with auto-retry, bulk
retry and Commit/Rollback directives, and it is **off by default** and quota-bounded. Neither
is a small addition, and neither is asked for by Carbon's PRD.

## Where Carbon can be better than the incumbents

- **Version-pinned history.** n8n has no execution↔version link at all; Zapier shows a version
  but its detail view is not rendered against it. Carbon stores `workflowVersionId` per run and
  can render the run against the exact frozen definition.
- **Per-clause condition evaluation.** No incumbent shows which clause of a condition failed.
  This is the direct answer to the most common support question.
- **Blocked runs as first-class rows.** Zapier's "safely halted" is the nearest equivalent;
  none of them link a halted run back to the run that caused it. Carbon already writes
  `causedByRunId` on a blocked row.
- **Redaction that preserves shape.** n8n's model — redact at the API layer so the value never
  reaches the browser, preserve node names, timing and error *type*, and gate any reveal behind
  an audited permission — maps cleanly onto Carbon's RBAC and audit log.

---
# Zapier — How Run History Is Surfaced

Research date: 2026-07-31. Purpose: reference design for an ERP no-code workflow builder's run-history surface.

Every claim below carries the URL it came from. Where Zapier's docs do **not** state something, that is called out explicitly as a gap rather than guessed at.

---

## 1. Naming and Top-Level Structure

- The surface is called **Zap history**. It is "a log of all Zap workflows that have run" and is used to "review your account task usage and troubleshoot Zap workflows." — https://help.zapier.com/hc/en-us/articles/8496291148685-View-and-manage-your-Zap-history
- The page has two tabs: **Zap runs** and **Task usage**. Transfers also surface inside Zap history. — https://help.zapier.com/hc/en-us/articles/8496291148685-View-and-manage-your-Zap-history
- Statuses are shown in two places: the Zap history page, **and** a "Zap runs sidebar in the Zap editor" — i.e. run history is embedded directly in the builder, not only in a separate log screen. — https://help.zapier.com/hc/en-us/articles/20505304170637-Review-run-statuses-in-Zaps
- There is a separate, deep-linkable **Zap run details** view. — https://help.zapier.com/hc/en-us/articles/20512774106125-View-specific-Zap-run-details

### Design takeaway
Two entry points to the same data: a global log (audit/usage lens) and an in-builder sidebar (debug lens). The in-builder sidebar is what makes "why did my workflow do nothing" answerable without leaving the canvas.

---

## 2. The Run List

### Per-row content
Zapier's docs do **not** publish an explicit column list. What is documented as visible per row:

- The **Zap run status** — the list is explicitly framed as "check the Zap run status to confirm it ran successfully."
- The Zap (workflow) identity, since rows are filterable and searchable by Zap name.
- Replayed runs are marked with a **replay icon**.
— https://help.zapier.com/hc/en-us/articles/8496291148685-View-and-manage-your-Zap-history

Fields documented as present once you open a run (so they exist per-run, even if not all are columns): run status, timestamp of the run date, the **Zap version number and version name** used for that run, and a unique **run ID**. — https://help.zapier.com/hc/en-us/articles/20512774106125-View-specific-Zap-run-details

### Pagination / volume caps
- "up to 10 Zap runs per page" — https://help.zapier.com/hc/en-us/articles/8496291148685-View-and-manage-your-Zap-history
- The history "will display up to 10,000 runs" total. — https://help.zapier.com/hc/en-us/articles/8496291148685-View-and-manage-your-Zap-history

### Filters
Documented filter dimensions:

| Filter | Notes |
|---|---|
| Date | date range over runs |
| Zap name | which workflow |
| Apps used in the Zap | integration-level slice |
| Folder the Zap is in | org/grouping slice |
| Zap owner | who owns the workflow (team plans) |
| Zap status | the run status values (below) |

Applied filters render as **removable buttons below the filter fields**. — https://help.zapier.com/hc/en-us/articles/8496291148685-View-and-manage-your-Zap-history

### Search
- Free-text **search box** matching Zap workflow names. — https://help.zapier.com/hc/en-us/articles/8496291148685-View-and-manage-your-Zap-history
- Search also matches **version identity**: you can search by version number (e.g. `v3`) or version name to find all runs that executed a given published version. — https://help.zapier.com/hc/en-us/articles/8496291148685-View-and-manage-your-Zap-history

### Notable gap
There is **no documented search by payload/data field value.** You cannot query "show runs where customer = ACME" from the list. Data values are only inspectable inside an individual run's Data in / Data out tabs. This is a real product gap and arguably the single biggest opportunity for an ERP equivalent (where "find the run that touched PO-1234" is the actual user question).

### Bulk actions on the list
- **Delete**: select rows via checkboxes, click `Delete X` (X = count selected). Semantics differ by status — for completed runs, deletion only removes the record; for runs still in flight, deletion **also stops the run from finishing**. — https://help.zapier.com/hc/en-us/articles/8496291148685-View-and-manage-your-Zap-history and https://help.zapier.com/hc/en-us/articles/20505304170637-Review-run-statuses-in-Zaps
- **Replay**: bulk replay is capped at **5,000 Zap runs selected at once**. — https://help.zapier.com/hc/en-us/articles/8496241726989-Replay-Zap-runs
- **Export**: export up to **5,000 Zap runs at a time**, as CSV or JSON, delivered by email to the account address with the subject "Your Zapier account data is ready to download." You can filter first, then export the filtered set. — https://help.zapier.com/hc/en-us/articles/8496294549005-Export-your-Zap-history

---

## 3. Statuses

Zapier documents a single status vocabulary applied at **two levels**: the Zap run (header) and the individual step. — https://help.zapier.com/hc/en-us/articles/20505304170637-Review-run-statuses-in-Zaps

All definitions in this section come from https://help.zapier.com/hc/en-us/articles/20505304170637-Review-run-statuses-in-Zaps

### The status list

| Status | Meaning (per Zapier) | Level |
|---|---|---|
| **Successful** | "the run completed without issues" | run + step |
| **Running** | "the run is in progress" | run + step |
| **Filtered** | "the conditions in a Filter step were not met, so the Zap did not run any subsequent steps" | run + step |
| **Skipped** | "a step did not run because of the result of a preceding step in the Zap" | **step only** — "You will only ever see this as a step run status, not a Zap run status" |
| **Errored** | "the run encountered an issue and did not run successfully" | run + step |
| **Handled error** | "an error handler ran as an alternative workflow after a step errored" | **run only** — "Only the Zap run will have a `Handled error` status" |
| **Safely halted** | "the run purposely stopped" — typically a search action that found no results and was configured not to continue | run + step |
| **On hold** | "the run is paused" (Zapier's older wording: *held*) | run + step |
| **Needs review** | "a step requires human review before the Zap can proceed" | run + step |
| **Delayed** | "the Zap run has a Delay step that is postponing the completion of the Zap run" | run + step |
| **Scheduled** | "the Zap run is scheduled to re-run because it encountered an error and autoreplay is enabled" | run + step |

### Roll-up rule (important for header design)
"Zap run statuses may be caused by more than one status, but the Zap run will only display one status." — i.e. Zapier deliberately collapses N step statuses into exactly one run-level badge. — https://help.zapier.com/hc/en-us/articles/20505304170637-Review-run-statuses-in-Zaps

### Terminal vs. in-flight
Zapier groups **Running, Needs review, On hold, Delayed, Scheduled** as "the Zap hasn't finished the run" — and warns that "Deleting the Zap run prevents the Zap from finishing the run." Terminal statuses are Successful / Filtered / Safely halted / Errored / Handled error. — https://help.zapier.com/hc/en-us/articles/20505304170637-Review-run-statuses-in-Zaps

### Status interactions worth copying
- **Delay cascade**: when a run is Delayed, "the Zap run and affected step run will have `Delayed` statuses, and all subsequent steps will have a `Filtered` status until the Zap continues running after the delay finishes." So downstream steps of a paused run are shown as not-yet-run rather than blank. — https://help.zapier.com/hc/en-us/articles/20505304170637-Review-run-statuses-in-Zaps
- **Hold cascade**: when a run is on hold, all subsequent steps take Filtered status too. — https://help.zapier.com/hc/en-us/articles/20505304170637-Review-run-statuses-in-Zaps

### On hold — the documented causes
The "On hold" status is one badge covering seven distinct operational causes, each with its own remedy:

1. **Flood protection** — "when Zapier checked for new data, too many steps (100+) were triggered," to prevent accidental mass task burn.
2. **Disconnected app account** — reconnect the account, then replay the held run.
3. **Task limit reached** for the plan, or a **premium app not available** on the plan — upgrade, then replay.
4. **Expired payment method** — update billing, then replay.
5. **App access policy** — an owner/admin restricted the app via allowed/restricted app lists.
6. **Zap has more than 100 steps** — split the workflow.
— https://help.zapier.com/hc/en-us/articles/37454233721869-How-to-troubleshoot-held-Zap-or-step-runs

### Design takeaway
"On hold" is a **queue-with-a-reason**, not a failure. The run is preserved intact and resumable; the reason string is what makes it actionable. An ERP equivalent should treat license/permission/quota blocks the same way: hold, don't drop, and surface the specific cause + remediation link.

---

## 4. The Single-Run Detail View

Source for this whole section: https://help.zapier.com/hc/en-us/articles/20512774106125-View-specific-Zap-run-details

### Layout — three panes
1. **Left sidebar**: run cards (the list of runs for this Zap), so you can flick between runs without leaving the detail view.
2. **Center**: the **Zap outline** — the steps of the workflow, rendered in order.
3. **Right sidebar**: step-specific detail for whichever step is selected.

### Run header (top of the outline)
- The Zap run status
- A link to view the Zap run on the Zap history page
- A timestamp of the run date
- **The Zap version used for that run**
- **The run ID** — "Each Zap run has a unique ID"
- Replay information, if the run was replayed

The version pin matters: you can tell whether a run executed the workflow definition you're currently looking at, or an older published version.

### Per-step row in the outline
Each step shows:
- The step run **status icon**
- The **app** used in the step
- The **step number and app event** used in the step
- **"A description of the trigger event or action event that occurred"** — a human-readable one-liner of what the step actually did, not just a status
- Additional error details for unsuccessful runs

### The four tabs (right sidebar)
"There are four possible tabs to help you review, depending on whether it's a trigger or action step and the step run status" — i.e. the tab set is **conditional on step type and outcome**, not fixed.

| Tab | Content |
|---|---|
| **Data in** | "the data that was sent to the connected app for the given step" — the resolved input payload after template/field mapping |
| **Data out** | "the data that was received from the connected app for the given step" — the response payload |
| **Troubleshoot** | "an AI-powered troubleshooting guide for errored Zap runs" — Zapier generates natural-language troubleshooting instructions for the errored step |
| **Logs** | "a detailed HTTP log for the step that can be used for troubleshooting" — raw request/response |

Caveat: "If the step errored as it was missing required information to complete the step, logs will not be available." — https://help.zapier.com/hc/en-us/articles/8496037690637-How-to-troubleshoot-errors-in-Zap-workflows

### Design takeaway
The Data in / Data out split is the whole debugging model. **Data in** = what your mapping produced (your bug). **Data out** = what the external system returned (their bug, or your input's bug). The Logs tab is the escape hatch to raw HTTP. The three-tier ladder — human description → resolved payloads → raw HTTP — is worth copying wholesale; an ERP version's Data in should be the resolved field mapping, and Data out the record diff or the created record's id.

---

## 5. The "Why Did My Workflow Do Nothing" Case

This is Zapier's most instructive design, because a filtered run is not an error but is the #1 source of "it's broken" support tickets.

### It is a first-class run, not an absence
A filter that stops the workflow still produces a **Zap run record with `Filtered` status** and a full step-by-step detail view. The trigger step's Data out is fully populated — you can see exactly what data arrived. — https://help.zapier.com/hc/en-us/articles/20505304170637-Review-run-statuses-in-Zaps and https://help.zapier.com/hc/en-us/articles/8496215226125-Zap-filters-are-not-working-properly

Downstream steps that never executed are shown as **`Skipped`** — "a step did not run because of the result of a preceding step in the Zap" — so the outline visually shows exactly where execution stopped. — https://help.zapier.com/hc/en-us/articles/20505304170637-Review-run-statuses-in-Zaps

### The reason is surfaced, but only partially
- Zapier shows a **yellow exclamation mark** meaning "the data did not pass the filter conditions." — https://help.zapier.com/hc/en-us/articles/8496215226125-Zap-filters-are-not-working-properly
- Where a field the filter referenced had no data, Zapier renders the literal token **`(missing value)`** in place of the value. This distinguishes "condition evaluated false" from "the field you filtered on wasn't even sent." — https://help.zapier.com/hc/en-us/articles/8496215226125-Zap-filters-are-not-working-properly
- Zapier's documented diagnosis procedure is manual: open the run, open the **trigger step's Data out** tab, find the field you filtered on, and check whether it shows `(missing value)` or a value that doesn't match your condition. — https://help.zapier.com/hc/en-us/articles/8496215226125-Zap-filters-are-not-working-properly
- Users also report a run-detail message of the form "This filter successfully stopped your run" — framing the stop as correct behavior rather than a failure. (Community-reported UI string, not in a help article: https://community.zapier.com/troubleshooting-99/zap-history-indicating-this-filter-successfully-stopped-your-run-in-error-26200)

### Notable gap
Zapier does **not** show a per-condition evaluation table (condition → left value → operator → right value → true/false). The user must eyeball Data out and mentally re-evaluate the filter. This is the clearest place an ERP equivalent can beat Zapier: render each condition with its resolved operands and a pass/fail marker.

### Runs that genuinely never existed
Separately, Zapier documents cases where **no run row appears at all**: the workflow is off ("Your Zap cannot run if it is not turned on"), the trigger never fired, the trigger sent no data, or the record predates the workflow ("Zap does not trigger from existing data" — deduplication against pre-existing records). — https://help.zapier.com/hc/en-us/articles/30582278131597-Zap-is-not-working

The distinction — **"ran and was filtered" (a row exists) vs "never triggered" (no row exists)** — is left for the user to infer from presence/absence in the list. That inference is a genuine UX weak point: the absence of a row carries no explanation. An ERP version could log a lightweight "trigger evaluated, no match" record, or at minimum show a "last evaluated" timestamp on the workflow.

---

## 6. Replay / Retry

### Two distinct replay modes
1. **Replay the error** — re-runs from the failed step onward.
2. **Replay all steps** — "the Zap will replay every single step in the Zap, including the trigger and all previous steps, regardless of their run status."
— https://help.zapier.com/hc/en-us/articles/8496241726989-Replay-Zap-runs

### Autoreplay
- When enabled, "Zapier will automatically replay any Zap run with an errored status." — https://help.zapier.com/hc/en-us/articles/19220226086797-What-is-replay
- **Up to 5 attempts** with an escalating backoff: 5 min → 30 min → 1 hr → 3 hr → 6 hr. "The final replay will occur about 10 hours, 35 minutes after the first error." — https://help.zapier.com/hc/en-us/articles/19220226086797-What-is-replay
- While waiting for an autoreplay, the run carries the **`Scheduled`** status. — https://help.zapier.com/hc/en-us/articles/20505304170637-Review-run-statuses-in-Zaps

### Constraints (the important part)
- **60-day window**: "You must replay steps within 60 days of the initial trigger event." — https://help.zapier.com/hc/en-us/articles/19220226086797-What-is-replay
- **The workflow must be turned on.** — https://help.zapier.com/hc/en-us/articles/19220226086797-What-is-replay
- **Autoreplay will not replay runs with an On hold status** — those require the underlying blocker to be fixed, then a manual replay. — https://help.zapier.com/hc/en-us/articles/19220226086797-What-is-replay
- **Filter and Paths steps are never replayed**, "even if replaying a previous failed step would change the conditions used in the Filter or Paths steps." This is a significant semantic: branch decisions are frozen at original-run time and are not re-evaluated on replay. — https://help.zapier.com/hc/en-us/articles/19220226086797-What-is-replay
- Sufficient remaining task quota is required to cover the replay attempts. — https://help.zapier.com/hc/en-us/articles/19220226086797-What-is-replay
- Bulk cap: **5,000 runs** selectable at once. — https://help.zapier.com/hc/en-us/articles/8496241726989-Replay-Zap-runs

### Plan gating
| Capability | Free | Paid (Professional / Team / Enterprise) |
|---|---|---|
| Manual replay of **errored** runs | Yes | Yes |
| Manual replay of **other** statuses (e.g. on hold) | No | Yes |
| Replay **entire** Zap run (all steps) | No | Yes |
| **Autoreplay** | No | Yes |
— https://help.zapier.com/hc/en-us/articles/8496241726989-Replay-Zap-runs and https://help.zapier.com/hc/en-us/articles/19220226086797-What-is-replay

### Immutability of the record — key design decision
A replay does **not** mutate the original run. "It will appear as a separate Zap run" with a replay icon indicating the number of replays, and "you can navigate between the original and replayed runs." — https://help.zapier.com/hc/en-us/articles/8496241726989-Replay-Zap-runs

Billing consequence: "Any successful steps will count towards your task usage, even if they were already counted in a previous run." — https://help.zapier.com/hc/en-us/articles/8496241726989-Replay-Zap-runs

### Related: replay with chosen data
The filter troubleshooting article references a **"Continue with selected record"** affordance to re-run using the exact data that hit the filter — i.e. replay-with-a-specific-payload, useful for testing a fixed condition against real data. — https://help.zapier.com/hc/en-us/articles/8496215226125-Zap-filters-are-not-working-properly

---

## 7. Retention

### The headline numbers
- **Default: 30 days** of Zap history. — https://help.zapier.com/hc/en-us/articles/8496327478413-Customize-Zap-history-retention-in-Zapier
- **Guaranteed maximum: 60 days.** "Zapier can only guarantee a maximum of 60 days of Zap run data in your Zap history and will display up to 10,000 runs." — https://help.zapier.com/hc/en-us/articles/8496291148685-View-and-manage-your-Zap-history
- **Actual observed window: 29–69 days**, because deletion runs on a monthly cadence rather than a rolling per-record TTL. — https://zapier.com/legal/data-retention-deletion

### Why the range — the deletion cadence
Deletion happens **on the first Monday of each month**, sweeping everything older than the current + previous month:
- Immediately **before** the sweep, an account can hold up to **69 days** of Zap Content and Zap History (up to 7 days of the current month depending on where Monday falls, up to 31 days of last month, up to 31 days of the month before).
- Immediately **after** the sweep, at least **29 days** are retained.
— https://zapier.com/legal/data-retention-deletion

This batch-sweep model is a meaningful architectural choice: it trades a precise per-record TTL for a cheap monthly bulk delete, and it means "how long is my data kept" has no single answer.

### Plan differences
- Custom retention is an **Enterprise-only** control. Free, Professional, and Team cannot adjust it. — https://help.zapier.com/hc/en-us/articles/8496327478413-Customize-Zap-history-retention-in-Zapier
- Enterprise owners / admins / super admins set it under **Admin settings → Security and privacy**, with a slider constrained to **7–30 days**. Note the direction: Enterprise can only make retention *shorter*, for compliance — it is a privacy control, not a "keep my data longer" upsell. — https://help.zapier.com/hc/en-us/articles/8496327478413-Customize-Zap-history-retention-in-Zapier
- The setting applies to "all Zap history for shared and unshared Zap workflows" across every team member — account-wide, not per-workflow. — https://help.zapier.com/hc/en-us/articles/8496327478413-Customize-Zap-history-retention-in-Zapier
- Changes take effect immediately but actual deletion "may take up to 24 hours," and "Zap history deletion is permanent." — https://help.zapier.com/hc/en-us/articles/8496327478413-Customize-Zap-history-retention-in-Zapier

### "Run header" vs "task detail" — the answer is: no documented distinction
Zapier's docs do **not** document a tiered retention where run metadata survives longer than step payloads. The retention article "does not distinguish between task details versus metadata"; the whole record — "Zap Content and Zap History" — goes together. — https://help.zapier.com/hc/en-us/articles/8496327478413-Customize-Zap-history-retention-in-Zapier and https://zapier.com/legal/data-retention-deletion

The only documented tiering is on **API request logs, kept 7 days** for troubleshooting and then deleted — a shorter tier than Zap history, not a longer one. — https://zapier.com/legal/data-retention-deletion

### The escape hatch
Long-term records are the customer's problem: "If you need to keep longer-term records of your Zap run data, you can regularly export your Zap history" — 5,000 runs per export, CSV or JSON, emailed. — https://help.zapier.com/hc/en-us/articles/8496291148685-View-and-manage-your-Zap-history and https://help.zapier.com/hc/en-us/articles/8496294549005-Export-your-Zap-history

### Design takeaway for an ERP
Zapier's flat model is a poor fit for ERP. Manufacturing/quality contexts want the **run header retained indefinitely** (audit: "workflow X fired on PO-1234 on this date, outcome Y") while the **payload blobs age out** on a much shorter clock (storage + PII). Splitting header from payload with independent TTLs is the obvious improvement over what Zapier ships, and it is exactly the distinction Zapier does not make.

---

## 8. Data Privacy / Redaction

### What is stored
Zap history stores the **trigger payload in full** — every field in the trigger data, including any personal data present — plus per-step Data in / Data out payloads and HTTP logs. There is no documented field-level opt-out for Zap history content. — https://zapier.com/legal/data-retention-deletion and https://help.zapier.com/hc/en-us/articles/20512774106125-View-specific-Zap-run-details

### Documented redaction — narrow
The only documented redaction is for **credential fields**, not business data:
- Zapier's field-type system has a **password field type**: "the same as string fields, but the value you enter is hidden from view. Some apps use password fields for sensitive data." — https://help.zapier.com/hc/en-us/articles/8496259603341-Field-types-in-Zaps
- Per Zapier platform/community guidance, environment and password-typed auth fields are redacted in logs; developers building integrations must opt in by typing the field correctly, and there are reported cases of tokens not being censored when the field type was wrong. (Community/platform-level, not a help-center guarantee: https://community.zapier.com/general-discussion-13/how-to-redact-fields-in-auth-data-8831)

### Compliance posture
"Zapier takes the protection of our customers' information seriously and is committed to complying with applicable data privacy laws, including GDPR, UK GDPR, and CCPA." Retention shortening (7–30 days on Enterprise) is positioned as the primary privacy lever. — https://zapier.com/legal/data-privacy and https://help.zapier.com/hc/en-us/articles/8496327478413-Customize-Zap-history-retention-in-Zapier

### Notable gap
There is **no documented per-field redaction, masking, or "do not log this field" control for business data** flowing through a Zap. The only levers are (a) shorten retention account-wide, (b) manually delete runs, (c) don't route sensitive fields through the workflow in the first place. For an ERP handling pricing, wages, customer PII, or ITAR-adjacent data, a per-field "sensitive — store masked" flag on the workflow node config would be a straightforward differentiator.

---

## 9. Task Usage (relevant because it shapes the run list)

The Task usage tab exists because Zapier bills per successful action, which forces run history to double as a billing ledger. Rules:

**Counts as a task:** all successful action steps; any successful step inside an error-handler path; previously-successful steps that run again on a full replay; Sub-Zap call/return steps; a search action configured to continue when nothing is found.

**Does not count:** triggers ("Zap triggers never use tasks"); any Filter or Paths step; action steps that error or halt; searches configured not to continue when nothing found; "all steps that do not run, either because of a previous filter or path condition"; utility apps (Formatter, Delay, Looping, Digest, Storage, Zapier Manager).
— https://help.zapier.com/hc/en-us/articles/8496196837261-How-is-task-usage-measured-in-Zapier

### Design takeaway
A **Filtered run costs nothing** — reinforcing that Filtered is a normal, expected, high-volume outcome rather than an exception. An ERP without per-task billing has no reason to build a usage tab, which frees the run list to be purely a debugging/audit surface — and means filtered runs can be logged liberally without a cost narrative attached.

---

## 10. Consolidated Design Implications for the ERP Builder

1. **Two surfaces, one data model** — a global run log (filter by workflow / status / date / owner / module) plus an in-builder run sidebar with per-step drill-down. The in-builder view is where debugging actually happens.
2. **Filtered/condition-stopped is a first-class run with a row**, never an absence. Downstream nodes render as Skipped so the stop point is visually obvious.
3. **Beat Zapier on the "why" for filters**: show a per-condition evaluation table with resolved left/right operands and pass/fail, and adopt an explicit `(missing value)` token so "false" and "field absent" are visually distinct.
4. **Data in / Data out per node** is the right primitive: Data in = resolved mapping after templating, Data out = what the target returned. Add a raw-log tier behind them.
5. **Pin the workflow version + a unique run ID on every run header**, and make version searchable — essential once workflows are versioned and published.
6. **Replays create new immutable runs** linked to the original; never mutate history. Decide deliberately whether branch/condition nodes re-evaluate on replay — Zapier freezes them, which is surprising and worth diverging from.
7. **Model "On hold" as a resumable queue with a specific reason** (permission denied, quota, disconnected integration, record locked), not as a failure.
8. **Split retention: keep the run header long (audit), expire payloads short (PII/storage).** This is the one place Zapier's model is clearly inadequate for ERP.
9. **Add payload-value search** (e.g. by document number / record id). Zapier lacks it and it is the dominant ERP query.
10. **Add per-field sensitivity flags** so wages/pricing/PII can be masked in stored run data — no equivalent exists in Zapier.

---

## Source Index

- View and manage your Zap history — https://help.zapier.com/hc/en-us/articles/8496291148685-View-and-manage-your-Zap-history
- Review run statuses in Zaps — https://help.zapier.com/hc/en-us/articles/20505304170637-Review-run-statuses-in-Zaps
- View specific Zap run details — https://help.zapier.com/hc/en-us/articles/20512774106125-View-specific-Zap-run-details
- Zap filters are not working properly — https://help.zapier.com/hc/en-us/articles/8496215226125-Zap-filters-are-not-working-properly
- How to troubleshoot errors in Zap workflows — https://help.zapier.com/hc/en-us/articles/8496037690637-How-to-troubleshoot-errors-in-Zap-workflows
- How to troubleshoot held Zap or step runs — https://help.zapier.com/hc/en-us/articles/37454233721869-How-to-troubleshoot-held-Zap-or-step-runs
- Zap is not working — https://help.zapier.com/hc/en-us/articles/30582278131597-Zap-is-not-working
- What is replay? — https://help.zapier.com/hc/en-us/articles/19220226086797-What-is-replay
- Replay Zap runs — https://help.zapier.com/hc/en-us/articles/8496241726989-Replay-Zap-runs
- Customize Zap history retention in Zapier — https://help.zapier.com/hc/en-us/articles/8496327478413-Customize-Zap-history-retention-in-Zapier
- Export your Zap history — https://help.zapier.com/hc/en-us/articles/8496294549005-Export-your-Zap-history
- How is task usage measured in Zapier — https://help.zapier.com/hc/en-us/articles/8496196837261-How-is-task-usage-measured-in-Zapier
- Field types in Zaps — https://help.zapier.com/hc/en-us/articles/8496259603341-Field-types-in-Zaps
- Data Retention/Deletion/Export (legal) — https://zapier.com/legal/data-retention-deletion
- Data Privacy Overview (legal) — https://zapier.com/legal/data-privacy
- Community (secondary, flagged as such): filter "successfully stopped your run" — https://community.zapier.com/troubleshooting-99/zap-history-indicating-this-filter-successfully-stopped-your-run-in-error-26200 ; redacting auth fields — https://community.zapier.com/general-discussion-13/how-to-redact-fields-in-auth-data-8831
# Workflow Execution History — n8n & Make.com (Integromat)

Research for designing run-history / execution-log UX in Carbon's no-code workflow builder.
Date: 2026-07-31. Every claim carries a URL.

> Note on n8n docs URLs: n8n restructured its docs in 2026. Old paths
> (`/workflows/executions/…`, `/hosting/scaling/…`, `/hosting/configuration/…`) now 404 and
> content lives under `/build/…`, `/deploy/…`, `/connect/…`. URLs below are the live ones.

---

## n8n

### The Executions list

#### Two scopes: global and per-workflow

n8n has two entry points into run history:

- **Per-workflow** — "In the workflow, select the **Executions** tab in the top menu to preview
  all executions of that workflow."
  <https://docs.n8n.io/build/understand-workflows/understand-executions/view-executions-for-a-single-workflow>
- **Global / all executions** — a cross-workflow view reached from the Overview page.
  <https://docs.n8n.io/build/understand-workflows/understand-executions/view-all-executions>

#### Columns

The executions list surfaces, per row: **status, workflow name, start time, and execution
duration**; execution metadata carried on the record includes workflow ID, execution ID, start
time, end time, execution mode (manual / trigger / webhook), and status.
<https://deepwiki.com/n8n-io/n8n-docs/9.3-execution-data-and-history>

Item counts are not a list column — they live in the per-node panes of the detail view (see below).

#### Statuses

Two different sets matter, and this is a real design trap:

**The full status vocabulary** (what the API and DB actually store) is
`canceled, crashed, error, new, running, success, unknown, waiting`.
<https://docs.n8n.io/connect/n8n-api/execution>

**The UI filter vocabulary is narrower** — the executions filter offers only
**Failed, Running, Success, Waiting**.
<https://docs.n8n.io/build/understand-workflows/understand-executions/view-all-executions>

So n8n collapses `error` + `crashed` into "Failed" for filtering, and `new` / `canceled` /
`unknown` aren't directly filterable. `new` = accepted but not yet started; `crashed` = the
process died rather than the workflow erroring.

A separate **queued** state exists under concurrency control: "Any executions beyond the limits
queue for later processing. These executions remain in the queue until concurrency capacity frees
up, and are then processed in FIFO order."
<https://docs.n8n.io/deploy/use-n8n-cloud/understand-concurrency>

#### Filters

- **Workflows** — "choose all workflows, or a specific workflow name" (global view only)
- **Status** — Failed / Running / Success / Waiting
- **Execution start** — "see executions that started in the given time"
- **Saved custom data** — "this is data you create within the workflow using the Code node. Enter
  the key and value to filter"

<https://docs.n8n.io/build/understand-workflows/understand-executions/view-all-executions>

The *saved custom data* filter is the interesting one for an ERP: it lets a builder stamp a
business key (customer ID, order number) onto the execution at runtime and then search history by
it. There is also an **Execution Data** node dedicated to writing this metadata.
<https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executiondata>

The API exposes richer filtering than the UI, including `annotationTags` and `vote`.
<https://deepwiki.com/n8n-io/n8n/3.3-execution-management-api>

#### Annotations (tags + rating)

Executions can be annotated with tags and a good/bad rating. Two API operations exist —
`GET /executions/{id}/tags` and `PUT /executions/{id}/tags`.
<https://docs.n8n.io/connect/n8n-api/execution>

Crucially, **annotated executions are never pruned** — annotation doubles as a "pin this run
forever" mechanism.
<https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/manage-execution-data>

#### Link between executions and workflow versions

This is n8n's **weakest area**, and worth diverging from.

- The per-workflow executions list shows "previous runs of the **current version** of the
  workflow" — i.e. the list is scoped to the workflow entity, not a version snapshot.
  <https://docs.n8n.io/build/understand-workflows/understand-executions/view-executions-for-a-single-workflow>
- "When you delete a workflow, n8n deletes its execution history as well," so history has no
  independent lifetime.
  <https://docs.n8n.io/build/understand-workflows/understand-executions/view-all-executions>

The only place version identity is made explicit is **retry**, where the user must choose between
two semantics:

- **"Retry with currently saved workflow"** — replay the old execution's *data* through the
  *current* workflow definition (use after you've fixed the workflow).
- **"Retry with original workflow"** — replay without picking up your changes.

<https://docs.n8n.io/build/understand-workflows/understand-executions/view-executions-for-a-single-workflow>

The execution record carries `retryOf` and `retrySuccessId` fields so retries chain back to the
original run.
<https://docs.n8n.io/connect/n8n-api/execution>

**Design implication:** because Carbon already versions and publishes workflows, storing the
`workflowVersionId` on every run — and rendering history against that frozen snapshot — is a
strict improvement over n8n. It removes the "why does this old run look nothing like my canvas"
confusion that n8n's retry dialog is a band-aid for.

---

### The execution detail view (the canvas replay)

#### The core idea: history renders ON the canvas, not in a table

Opening an execution loads the workflow graph with the run's data overlaid. Node status is shown
by highlighting on the canvas, and clicking any node opens the standard node detail view with its
**INPUT** and **OUTPUT** panes populated with that run's actual data — "you can see the exact data
that came in and went out of each node through the Input/Output panel, which is the primary
debugging tool," and you "click any execution to inspect node-by-node input and output data."
<https://deepwiki.com/n8n-io/n8n-docs/9.3-execution-data-and-history>
<https://aiworkflowsautomation.com/understanding-the-n8n-interface-canvas-nodes-and-executions/>

Documented execution metadata explicitly includes **timing, status, and item counts** per node.
<https://deepwiki.com/n8n-io/n8n-docs/9.3-execution-data-and-history>

n8n has also added a **logs panel** alongside the canvas, which lists the per-node runs in
sequence (a July 2026 release note covers "display canvas groups in logs panel") — so the modern
detail view is *canvas + node panes + a linear log panel*, giving both the topological and the
chronological reading of the same run.
<https://releasebot.io/updates/n8n>

#### Display-size ceiling

`EXECUTIONS_DATA_MAX_DISPLAY_SIZE` (default `104857600` = 100 MB) is "Maximum size (in bytes) of
execution data that n8n loads when displaying an execution." Above that, n8n refuses to render the
payload.
<https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables/executions>

**Design implication:** a hard display-size cap with graceful degradation is a necessary
primitive, not a nice-to-have. Plan for "this run's data is too large to display" up front.

#### Manual vs production vs partial executions

- **Manual** — triggered by the Execute Workflow button; ad-hoc runs to "test your workflow logic"
  iteratively on the canvas.
- **Production** — "a triggering event or schedule automatically runs a workflow"; counts toward
  execution quota.
- **Partial** — select a node, open its detail view, choose **Execute step**; this runs "the
  specific node and any preceding nodes required to fill in its input data." Documented as "useful
  when updating the logic of a specific node" because you rerun it with identical input data.

<https://docs.n8n.io/build/understand-workflows/understand-executions/types-of-executions>

**Key asymmetry:** "the execution flow for production executions doesn't display in the Editor tab
of the workflow as with manual executions." Manual runs animate live on the canvas; production
runs must be opened from the Executions tab after the fact.
<https://docs.n8n.io/build/understand-workflows/understand-executions/types-of-executions>

#### Pin data / replay story

**Pin data** is a *build-time* mechanism, not a history mechanism, and conflating the two would be
a mistake:

- "Data pinning means saving the output data of a node, and using the saved data instead of
  fetching fresh data in future workflow executions." On future runs "instead of executing the
  pinned node, n8n will substitute the pinned data and continue following the flow logic."
- Set via **Pin data** in the OUTPUT view; when active the button is disabled and a "This data is
  pinned" banner shows.
- Purpose: avoid re-hitting external systems, avoid burning API/usage limits, and test
  webhook-triggered workflows without firing the external system.
- **Limits:** only nodes with a single main output (error outputs don't count); not available when
  output includes binary data.
- **Critically: "Data pinning isn't available for production workflow executions. Production
  executions ignore all pinned data."**

<https://docs.n8n.io/data/data-pinning/>

So n8n's replay story splits three ways:

| Mechanism | Scope | What it reuses |
|---|---|---|
| Pin data | Manual/dev only, ignored in production | Frozen *output* of a node, substituted for execution |
| Partial execution ("Execute step") | Manual | Re-runs one node + its ancestors |
| Retry execution | Production history | The past run's data, against current OR original workflow |

<https://docs.n8n.io/data/data-pinning/> ·
<https://docs.n8n.io/build/understand-workflows/understand-executions/types-of-executions> ·
<https://docs.n8n.io/build/understand-workflows/understand-executions/view-executions-for-a-single-workflow>

---

### Live / current execution view

Yes, but only partially, and the split is the notable part.

- **Manual executions animate live on the canvas** — the flow displays in the Editor tab as it
  runs. **Production executions do not**; "the execution flow for production executions doesn't
  display in the Editor tab of the workflow as with manual executions."
  <https://docs.n8n.io/build/understand-workflows/understand-executions/types-of-executions>
- **`running` and `new` are first-class statuses**, so in-flight runs appear in the list and are
  filterable by "Running."
  <https://docs.n8n.io/connect/n8n-api/execution> ·
  <https://docs.n8n.io/build/understand-workflows/understand-executions/view-all-executions>
- **Live concurrency counter** — you can "view the number of active executions and your plan's
  concurrency limit at the top of a project's or workflow's executions tab."
  <https://docs.n8n.io/deploy/use-n8n-cloud/understand-concurrency>
- **Stop** — the API exposes `POST /executions/{id}/stop` and a bulk `POST /executions/stop`.
  <https://docs.n8n.io/connect/n8n-api/execution>
- **Queued executions are second-class**: "You can't retry queued executions. Cancelling or
  deleting a queued execution also removes it from the queue."
  <https://docs.n8n.io/deploy/use-n8n-cloud/understand-concurrency>

Whether you can watch a *production* run node-by-node in real time depends on
`EXECUTIONS_DATA_SAVE_ON_PROGRESS` — "Whether to save progress for each node executed (true) or
not (false)", **default `false`**. With it off, there is no per-node partial state to stream; the
row shows `running` and nothing more until it finishes.
<https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables/executions>

**Design implication:** per-node progress persistence is the switch that makes a live view
possible at all, and n8n defaults it OFF because of the write cost. Decide this deliberately —
"watch it run" is a database-write-amplification decision, not a UI decision.

---

### Data retention

#### Saving policy — what gets recorded in the first place

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `EXECUTIONS_DATA_SAVE_ON_ERROR` | `all` \| `none` | `all` | Whether n8n saves execution data on error |
| `EXECUTIONS_DATA_SAVE_ON_SUCCESS` | `all` \| `none` | `all` | Whether n8n saves execution data on success |
| `EXECUTIONS_DATA_SAVE_ON_PROGRESS` | boolean | `false` | Whether to save progress for each node executed |
| `EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS` | boolean | `true` | Whether to save data of executions when started manually |
| `N8N_EXECUTION_DATA_STORAGE_MODE` | `database` \| `filesystem` \| `s3` \| `azure` | `database` | Where n8n stores execution data |
| `EXECUTIONS_DATA_MAX_DISPLAY_SIZE` | number (bytes) | `104857600` | Max size loaded when displaying an execution |

<https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables/executions>

The success/error split is the important product idea: many operators set
`SAVE_ON_SUCCESS=none, SAVE_ON_ERROR=all` — keep the forensics, drop the noise. This is the single
highest-leverage retention knob.

#### Pruning — soft delete then hard delete

"Executions pruning deletes finished executions along with their execution data and binary data on
a regular schedule."
<https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/manage-execution-data>

Pruning is **two-phase**: records are first *soft-deleted* (marked), then *hard-deleted*
(physically removed) after a safety buffer, so recent data stays available while a user is
building or debugging.
<https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/manage-execution-data> ·
<https://deepwiki.com/n8n-io/n8n-docs/3.7-execution-data-management-and-pruning>

| Variable | Type | Default | Meaning |
|---|---|---|---|
| `EXECUTIONS_DATA_PRUNE` | boolean | `true` | Delete data of past executions on a rolling basis |
| `EXECUTIONS_DATA_MAX_AGE` | number (hours) | `336` (14 days) | The execution age before it's deleted |
| `EXECUTIONS_DATA_PRUNE_MAX_COUNT` | number | `10000` | Max executions to keep in the DB |
| `EXECUTIONS_DATA_HARD_DELETE_BUFFER` | number (hours) | `1` | How old finished execution data must be to get hard-deleted |
| `EXECUTIONS_DATA_PRUNE_HARD_DELETE_INTERVAL` | number (minutes) | `15` | How often execution data is hard-deleted |
| `EXECUTIONS_DATA_PRUNE_SOFT_DELETE_INTERVAL` | number (minutes) | `60` | How often execution data is soft-deleted |

<https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables/executions>

**Two independent triggers**, whichever fires first:

1. **Age-based** — finished more than `EXECUTIONS_DATA_MAX_AGE` hours ago (default 336h / 14 days)
2. **Count-based** — total executions exceed `EXECUTIONS_DATA_PRUNE_MAX_COUNT` (default 10,000),
   deleting oldest → newest

<https://deepwiki.com/n8n-io/n8n-docs/3.7-execution-data-management-and-pruning>

#### What is exempt from pruning

- "Executions with the `new`, `running`, or `waiting` status aren't eligible for pruning."
- "Annotated executions (for example, executions with tags or ratings) are **never** pruned."

<https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/manage-execution-data>

Binary data: pruning targets the currently active binary data storage mode only, not historical
storage backends — i.e. switching storage mode strands old binaries.
<https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/manage-execution-data>

**Design implication for Carbon:** the soft/hard split plus a starvation guard for in-flight runs
plus a never-prune escape hatch (annotation/pin) are three separately valuable primitives. The
count-based cap is what actually protects the database — age alone doesn't bound a runaway
workflow.

#### Auto-deactivation on repeated failure

Adjacent but relevant: `N8N_WORKFLOW_AUTODEACTIVATION_ENABLED` (boolean, default `false`) —
"Whether workflows are automatically unpublished after repeated crashed executions" — with
`N8N_WORKFLOW_AUTODEACTIVATION_MAX_LAST_EXECUTIONS` (default `3`) crashed executions as the
threshold.
<https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables/executions>

---

### Sensitive data / credential redaction in execution logs

n8n ships a dedicated **Execution data redaction** feature (Enterprise Self-hosted and Enterprise
Cloud, n8n 2.16.0+).
<https://docs.n8n.io/deploy/host-n8n/configure-n8n/security/redact-execution-data>

**What it does:** "Execution data redaction lets you hide the input and output data of workflow
executions." Metadata — node names, timing, status — stays visible; payloads are replaced.

**What gets redacted:**
- Item JSON data — input/output for each node replaced with empty objects
- Binary data — files and images removed
- Fields marked sensitive by node authors
- Error messages, "preserving only the error type and HTTP status code"

**Error redaction detail:** "Only the error type (for example, `NodeApiError`) and HTTP status code
remain. This provides enough information to identify the category of failure without exposing
data."

**Where it's configured:**
- Per-workflow — workflow Settings → "Redact production execution data" and/or "Redact manual
  execution data" (independent toggles)
- Instance-wide — Settings → Security → Data redaction (n8n 2.26.0+)

**Enforcement point:** redaction is applied **at the API layer** and "never sends redacted data to
the browser," and it also propagates to log streaming and logging output. That's the right
architecture — redact at the boundary, not in the renderer.

**Break-glass:** users with the `execution:reveal` scope can *temporarily* view redacted data for a
specific execution; instance owners and admins hold it by default. All reveals are written to the
audit trail via `n8n.audit.execution.data.revealed`,
`n8n.audit.execution.data.reveal_failure`, and `n8n.audit.redaction-enforcement.updated`. Reveals
are **denied outright for executions using dynamic credentials**.

**Credentials generally:** "n8n doesn't log or export credentials by default." When used, they're
loaded into the execution environment rather than serialized into the run record.
<https://docs.n8n.io/hosting/securing/overview/>

Related: executions using end-user credentials show redacted output for all users except the one
whose account ran the node.
<https://docs.n8n.io/build/understand-workflows/understand-executions/view-executions-for-a-single-workflow>

**Design implication for an ERP:** this is the model to copy. Per-workflow opt-in, redact at the
API boundary, keep the shape (node names, timing, status, error *type*) so debugging still works
without the payload, and gate reveal behind a named permission with an audit record. In Carbon
terms that maps cleanly onto the existing RBAC + audit-log subsystems.

---

## Make.com (Integromat)

### Scenario History

"Scenario history contains information about runs and user modifications to scenarios" — it tracks
**both execution data and configuration changes** in one timeline.
<https://help.make.com/scenario-history>

That combined audit view is a notable divergence from n8n: change-log entries record scheduling
modifications, edits to the scenario, and activation changes, interleaved with run entries.
<https://help.make.com/scenario-history>

#### Columns on a run entry

Per <https://help.make.com/scenario-history>, each run row carries:

- Run date and time
- Run name
- Trigger or activity type
- Status
- Run duration
- **Operations consumed**
- **Data transfer size**
- Link to source scenario
- **Replay option**

Operations and data transfer being *first-class list columns* is the defining Make characteristic
— history doubles as the billing/cost ledger, because Make prices on operations.
<https://help.make.com/scenario-history>

#### List features

- Filter which columns are visible via the filter icon
- Hide check runs or change-log entries via the three-dot menu
- **Export history as CSV**
- **Full-text search** across execution logs (paid plans)

<https://help.make.com/scenario-history>

#### Statuses

Run entries display **success, warning, error**.
<https://help.make.com/scenario-history>

Note the vocabulary difference from n8n: Make has a distinct **warning** tier (a run that finished
but with a handled/partial problem), plus **incomplete** as a separate queue rather than a status
in the main list (see below).
<https://growwstacks.com/blog/how-to-use-make-com-scenario-history>

---

### The detail of an execution

Clicking **Details** on a history row opens **the scenario diagram** with an execution details
panel on the right — the same canvas-overlay pattern as n8n.
<https://experienceleague.adobe.com/en/docs/workfront-fusion/using/manage-scenarios/view-a-specific-scenario-execution>

> Sourcing note: Adobe Workfront Fusion is a white-labeled Make/Integromat engine, and its docs
> describe the identical execution-detail UI in far more mechanical detail than Make's own help
> center. Treated here as authoritative on engine behavior.

#### Per-module display

- **Modules that produced output are marked with green titles; modules that did not run are
  dimmed.** Dimming non-executed branches is a cheap, high-value signal for showing which path a
  conditional actually took.
- **Bubbles** appear near each module. "The number in the bubble represents the number of bundles
  that the module output." Clicking the bubble "reveals the data bundles that module produced
  during that execution."
- For filters: "The number near the filter represents the number of bundles that passed through
  the filter" — so drop-off is visible directly on the connector.

<https://experienceleague.adobe.com/en/docs/workfront-fusion/using/manage-scenarios/view-a-specific-scenario-execution>

#### Input bundle / output bundle

Per module the detail view exposes:

- **Input** — data received from the previous step or trigger
- **Output** — data the module produced, including mapped fields
- **Metadata** — time, operation counts, and HTTP status codes for some connectors

<https://consultevo.com/make-com-scenario-history-guide/>

The run detail is "a structured archive of all modules and their outputs," including a timeline of
executed modules in the order they ran, bundles of data produced by each module, status for every
operation (success, error, skipped), and input/output data for each module.
<https://consultevo.com/make-com-scenario-history-guide/>

Logs show "inputs, outputs, errors, duration, operations count, and even data transfer size."
<https://consultevo.com/make-com-scenario-history-guide/>

There is a **simple vs advanced log view toggle**.
<https://help.make.com/scenario-history>

#### Search within a run

Detail view has a "Search execution events" box with results appearing dynamically, plus a status
filter dropdown to narrow by Success / Warning.
<https://experienceleague.adobe.com/en/docs/workfront-fusion/using/manage-scenarios/view-a-specific-scenario-execution>

**Design implication:** Make's "bundle count bubble on every connector" is arguably the best single
idea in either product. It turns the graph into a data-flow sankey at a glance — you see where
items were lost without opening a single node. Cheap to render, very high diagnostic value.

---

### Errors, the Incomplete Executions queue, and resuming

#### What incomplete executions are

"Incomplete executions are a safety feature that protects [scenarios] from stopping due to errors
and from data loss." When an error hits, Make "stores the unfinished scenario run in the incomplete
executions tab," where "you can check the run, investigate why the error happened, and fix it to
finish the run successfully."
<https://help.make.com/incomplete-executions> · <https://help.make.com/overview-of-error-handling>

**They are OFF by default.** The feature is "disabled by default" and requires enabling the "store
incomplete executions" option in scenario settings.
<https://help.make.com/incomplete-executions>

Caveat: the first module doesn't trigger storage unless a retry error handler is attached.
<https://help.make.com/overview-of-error-handling>

#### Error handler directives

Make attaches error-handler *routes* to individual modules, each set to one of five directives:

| Directive | Behavior |
|---|---|
| **Skip** (Ignore) | "skips the error and removes the affected bundle from the flow" |
| **Retry** | stores error details and pauses until manual or automatic resolution |
| **Resume** | "replaces the failed module's output with a predefined substitute output" |
| **Commit** | stops execution and commits database changes made so far |
| **Rollback** | "reverts any changes in modules that support transactions" — the default |

<https://help.make.com/overview-of-error-handling>

A **Break** directive sends the failed execution to the Incomplete Executions queue rather than
discarding it, and exposes two automatic-retry parameters: **retry attempt limit** (1–10) and
**interval between retries** in minutes. Make uses a fixed interval, not exponential backoff.
<https://alltomate.com/blogs/make-com-error-handling/>

#### Error classes

- Handled by default as temporary: `RateLimitError`, `ConnectionError`
- Require custom handling: `InvalidAccessTokenError`, `InconsistencyError`
- Trigger immediate scenario disabling: `AccountValidationError`,
  `OperationsLimitExceededError`, `DataSizeLimitExceededError`

<https://help.make.com/overview-of-error-handling>

A **"number of consecutive errors"** setting (default 3) governs how many repeated failures a
scenario tolerates before being disabled.
<https://help.make.com/overview-of-error-handling>

#### Resuming

Incomplete executions can be resolved "manually one by one or retry multiple of them at once."
<https://help.make.com/overview-of-error-handling>

Recent improvement: "users can now retry multiple incomplete executions at once — you can either
select specific incomplete executions or attempt to retry all of them," and users can see
approximately when incomplete executions will be rerun.
<https://help.make.com/incomplete-executions-retry>

Three resolution paths: automatic retry for supported error types, break error handlers, or
manually deleting the incomplete executions.
<https://help.make.com/incomplete-executions>

#### Related scenario settings

- **Store incomplete executions** — off by default; the master switch.
- **Process data in order (sequential processing)** — process runs in the order received, each
  finishing before the next starts. "If there's an incomplete execution, no new runs are processed
  until all incomplete executions are resolved." This is head-of-line blocking as an explicit,
  opt-in guarantee.
- **Enable data loss** — controls what happens when Make *cannot* create an incomplete execution
  (usually because incomplete-execution storage is full). Kept disabled, "the scenario pauses
  scheduling to avoid losing any more runs, until you clear the incomplete execution storage."
  Enabled, the scenario keeps running and drops the failed runs.

<https://help.make.com/options-related-to-incomplete-executions> ·
<https://help.make.com/scenario-settings>

**Storage is quota'd:** "the maximum number of incomplete executions from all teams in an
organization depends on your usage allowance; if the limit is exceeded, you will receive an error
message."
<https://help.make.com/incomplete-executions>

**Design implication:** Make treats a failed run as *durable, resumable work* rather than a log
entry — a dead-letter queue with a UI. For an ERP this is the more valuable model than n8n's
retry-from-history, because a half-applied ERP side effect (PO created, receipt not posted) needs
an explicit operator queue, not a "run it again and hope" button. The `Commit`/`Rollback`
directives and the "process data in order" toggle both exist because Make's users hit exactly the
transactional-consistency problems an ERP has by default.

---

### Retention of execution logs

Retention is plan-tiered. Per Make's pricing page, the "Workflow execution" section lists log
retention as:

- **Free** — 7 days
- **Make Pro** — 30 days
- **Enterprise** — 60 days

<https://www.make.com/en/pricing>

Make's help center confirms the principle without numbers: "The number of days your run history
entries are stored depends on your pricing plan."
<https://help.make.com/scenario-history>

Full-text search of execution history is a paid-plan feature: "Quickly search for, identify, and
troubleshoot items in your scenario execution history."
<https://www.make.com/en/pricing>

> Caveat: Make has repeatedly renamed plan tiers (Core / Pro / Teams / Enterprise vs. the current
> Free / Make Pro / Enterprise). Treat the *shape* — single-digit days free, ~30 days standard,
> ~60 days enterprise — as the durable finding; verify exact numbers at purchase time.

Incomplete executions are retained separately and bounded by **count quota**, not by age.
<https://help.make.com/incomplete-executions>

---

## Cross-cutting comparison

| Dimension | n8n | Make.com |
|---|---|---|
| History scope | Per-workflow tab + global view | Per-scenario History tab, includes change log |
| Status vocabulary | 8 stored (`canceled, crashed, error, new, running, success, unknown, waiting`), 4 filterable | success / warning / error, + separate Incomplete queue |
| Cost columns | none | **Operations consumed + data transfer, in the list** |
| Detail view | Canvas overlay + node INPUT/OUTPUT panes + logs panel | Canvas overlay, green/dimmed modules, **bundle-count bubbles** |
| Item counts | in node panes | **on every connector, at a glance** |
| Failed-run handling | Retry (current or original workflow) | **Durable Incomplete Executions queue**, bulk retry, auto-retry |
| Live view | Manual runs animate on canvas; production runs don't | Not documented as live; history is post-hoc |
| Retention control | Self-host env vars: age + count, soft→hard delete | Plan-tiered days, not user-configurable |
| Never-delete escape hatch | **Annotations (tags/rating) are never pruned** | none documented |
| Version linkage | Weak — list is scoped to current version; retry dialog papers over it | Change log interleaved with runs |
| Redaction | **Enterprise: per-workflow toggles, API-layer redaction, `execution:reveal` + audit** | not documented in sources reviewed |

### Highest-value ideas to steal

1. **Bundle-count bubbles on connectors** (Make) — item counts on the graph itself, not buried in
   panes. Highest diagnostic value per pixel of anything in either product.
2. **Dimmed non-executed nodes** (Make) — instantly shows which branch a conditional took.
3. **Incomplete-executions queue** (Make) — treat failed runs as resumable work items, not log
   rows. Essential for an ERP with real side effects.
4. **`SAVE_ON_SUCCESS=none` / `SAVE_ON_ERROR=all` split** (n8n) — the single best retention knob.
5. **Two-phase soft→hard delete with a buffer, plus count-based *and* age-based caps** (n8n).
6. **Annotation = never pruned** (n8n) — user-controlled permanent retention without a separate
   archive feature.
7. **API-layer redaction preserving shape (node names, timing, error type) + audited reveal
   permission** (n8n) — maps directly onto Carbon's existing RBAC and audit-log subsystems.
8. **Saved custom data as a filter dimension** (n8n) — stamp business keys (order no., customer)
   on runs so history is searchable in domain terms, not just by timestamp.
9. **Explicit `workflowVersionId` on every run** — n8n's gap; Carbon already versions and
   publishes, so render history against the frozen snapshot and avoid the whole retry-semantics
   dialog.
10. **Operations/cost columns** (Make) — even without usage billing, a "records touched" or "side
    effects written" column makes blast radius legible before a rerun.

---

## Sources

### n8n
- <https://docs.n8n.io/build/understand-workflows/understand-executions/view-all-executions>
- <https://docs.n8n.io/build/understand-workflows/understand-executions/view-executions-for-a-single-workflow>
- <https://docs.n8n.io/build/understand-workflows/understand-executions/types-of-executions>
- <https://docs.n8n.io/connect/n8n-api/execution>
- <https://docs.n8n.io/data/data-pinning/>
- <https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables/executions>
- <https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/manage-execution-data>
- <https://docs.n8n.io/deploy/host-n8n/configure-n8n/security/redact-execution-data>
- <https://docs.n8n.io/deploy/use-n8n-cloud/understand-concurrency>
- <https://docs.n8n.io/hosting/securing/overview/>
- <https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executiondata>
- <https://deepwiki.com/n8n-io/n8n-docs/9.3-execution-data-and-history>
- <https://deepwiki.com/n8n-io/n8n-docs/3.7-execution-data-management-and-pruning>
- <https://deepwiki.com/n8n-io/n8n/3.3-execution-management-api>
- <https://releasebot.io/updates/n8n>
- <https://aiworkflowsautomation.com/understanding-the-n8n-interface-canvas-nodes-and-executions/>

### Make.com
- <https://help.make.com/scenario-history>
- <https://help.make.com/overview-of-error-handling>
- <https://help.make.com/incomplete-executions>
- <https://help.make.com/incomplete-executions-retry>
- <https://help.make.com/options-related-to-incomplete-executions>
- <https://help.make.com/scenario-settings>
- <https://www.make.com/en/pricing>
- <https://developers.make.com/api-documentation/api-reference/incomplete-executions>
- <https://experienceleague.adobe.com/en/docs/workfront-fusion/using/manage-scenarios/view-a-specific-scenario-execution>
- <https://experienceleague.adobe.com/en/docs/workfront-fusion/using/manage-scenarios/view-and-resolve-incomplete-executions>
- <https://consultevo.com/make-com-scenario-history-guide/>
- <https://alltomate.com/blogs/make-com-error-handling/>
- <https://growwstacks.com/blog/how-to-use-make-com-scenario-history>

### Source-quality note
Official vendor docs were used for every load-bearing claim (env var names, defaults, statuses,
settings, retention). Third-party sources (deepwiki, consultevo, alltomate, growwstacks,
releasebot) are cited only where vendor docs are thin — chiefly n8n's list columns and Make's
per-module input/output pane composition. Adobe Workfront Fusion docs are treated as
authoritative on Make engine behavior since Fusion is a white-labeled Make instance.
# How Serious Workflow Engines Present a Single Run

Research date: 2026-07-31. Targets: Temporal Web UI, AWS Step Functions console, Apache Airflow, Inngest, Trigger.dev, Windmill.

Every claim below is followed by the URL it came from.

---

## 1. How a single run's step list is presented

### 1.1 The three archetypes

There are exactly three presentation modes in use, and the mature products ship **two or three of them side by side with cross-selection**, not one:

1. **Graph overlay** — the static definition graph, colored by this run's per-step status.
2. **Ordered table / list** — one row per step, sortable/filterable, with duration.
3. **Timeline / waterfall (gantt)** — bars positioned proportionally by start time and duration.

### 1.2 AWS Step Functions — three synchronized views + a step-detail side panel

The Execution Details page has an explicit *View mode* section: "You can choose to view a graphic representation of the workflow, a table outlining the states in your workflow, or a list of the events associated with your state machine's execution." (https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html)

- **Graph view** — "displays a graphical representation of your workflow. A legend is included at the bottom that indicates the execution status." Zoom, center, fullscreen, export to SVG/PNG, horizontal/vertical layout toggle. (same URL)
- **Table view** — "a tabular representation of the states in your workflow… including its name, the name of any resource it used (such as an AWS Lambda function), and if the state executed successfully." Default columns: **Name, Type, Status, Resource, Started After**; column choice persists across executions via a Preferences dialog. (same URL)
- **Event view** — "The **Events** table displays the complete history for the selected execution as a list of events spanning multiple pages. Each page contains up to 25 events." Ascending by timestamp by default, color-coded by status, expandable per-event to reveal input/output/resource invocation. (same URL)

**The cross-selection is the key UX property**: "When you chose a step in the **Graph view**, the **Table view** also shows that step. This is true in reverse as well." (same URL)

**The gantt is an opt-in column, not a separate view**: "If you add the **Timeline** column, the execution duration of each state is shown with respect to the runtime for the entire execution. This is displayed as a color-coded, linear timeline. This can help you identify any performance-related issues with a specific state's execution." Retries render inline on that bar — "Red segments represent the failed `Retry` attempts, while light gray segments represent the `BackoffRate` between each `Retry` attempt." (same URL)

**Step details panel** opens on the right when a state is selected, with tabs: **Input**, **Output**, **Details**, **Definition**, **Retry** (renamed "Retries & redrives" if the execution was redriven), **Events** (a filtered subset of the global event list scoped to this step). Input/Output have an "Advanced view" toggle showing "the input data transfer path as the data passed through the selected state… as one or more of the fields, such as `InputPath`, `Parameters`, `ResultSelector`, `OutputPath`, and `ResultPath`, were applied to the data." (https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html)

### 1.3 Temporal — four views over one event history

The History tab offers **Timeline**, **All**, **Compact**, and **JSON**. (https://docs.temporal.io/web-ui)

- **Compact**: "A logical grouping of Activities, Signals and Timers" — event groups laid out left-to-right chronologically, repeated identical event types consolidated with counts, and "Event Groups that are scheduled at the same time are stacked on top of each other vertically." (https://temporal.io/blog/the-dark-magic-of-workflow-exploration)
- **Timeline**: clock-time aware — "Event Groups are stacked vertically, with clock-time durations as the length of each line connecting Events." Explicitly built for duration analysis between scheduled/started/completed. (same blog URL)
- **Full History**: git-tree style — "the thicker main line represents the Workflow - Workflow Tasks and Workflow Execution Events… with Event Groups branching out from it." This is the low-level view "for when you need all the low-level details, including Workflow Tasks." (same blog URL)
- **JSON**: "The full JSON code for the workflow." (https://docs.temporal.io/web-ui)

Note Temporal has **no definition graph at all** — a Temporal workflow is imperative code, so there is nothing to overlay. Its "step list" is purely the append-only event log, grouped.

### 1.4 Inngest — waterfall is the primary and only view

"The timeline is a waterfall visualization where each bar represents a span in the function execution. Bars are positioned proportionally to their start time and duration relative to the total run." (https://www.inngest.com/docs/platform/monitor/traces)

Span types shown as distinct bar categories: **Run** (root), **step.run / step.sleep / step.waitForEvent / step.invoke**, **Inngest** (queue delay), **Your server** (app execution time), and OpenTelemetry **Extended traces** child bars. Each step expands into two sub-bars: "Time in Inngest's queue before your server received the request" and "Time your server spent executing the step" — so you can "quickly identify whether latency is caused by queue congestion (Inngest bar) or your application code (server bar)." (same URL)

Layout: "The Function run details panel is divided in 3 parts" — timeline of steps bottom-left, event payload on the right, plus technical attributes (function version, timings). Full-page layout is available and recommended "for Function having a lot of steps or retries." (https://www.inngest.com/docs/platform/monitor/inspecting-function-runs)

Long-run ergonomics: a time brush in the timeline header — "Drag the handles to narrow the view, move the selection to pan across the timeline, click outside to expand it, or use the reset button to return to the full range." (https://www.inngest.com/blog/enhanced-observability-traces-and-metrics)

### 1.5 Airflow — grid (state matrix) + graph overlay + task-instance drilldown

- **Grid view**: "each row represents a task, and each column represents a Dag run" — a state matrix across runs, letting you "identify failed or retried tasks by color and tooltip." (https://airflow.apache.org/docs/apache-airflow/stable/ui.html)
- **Graph view**: "the logical structure of your Dag - how tasks are connected, what order they run in, and how branching or retries are configured", with a Dag-run dropdown so you can "switch between Dag runs and see how task states changed across executions." (same URL)
- **Task Instance view** tabs: Logs, Rendered Templates, XCom, Events, Code, Details. Details holds "Task ID and State… Operator used and runtime duration… Pool and slot usage." (same URL)
- Gantt was **removed in Airflow 3.0 then restored** in later 3.x, now folded into the grid rather than standing alone; and "each row in the task instance table includes a mini Gantt-style timeline that visually represents the task's duration." (https://airflow.apache.org/docs/apache-airflow/stable/ui.html, https://airflow.apache.org/blog/airflow-3.1.0/)

### 1.6 Trigger.dev / Windmill

- Trigger.dev: "Every task run is traced using OpenTelemetry, and Trigger.dev automatically captures spans for your task execution, subtask calls, and wait points." The run page timeline "shows the complete journey of a run, from trigger to execution to completion, with detailed visual steps of what happens in between… clearly delineating the steps performed before and after a run starts executing" — i.e. queueing/dequeue/boot phases are first-class bars, not hidden. (https://trigger.dev/docs/runs, https://trigger.dev/changelog/run-page-timeline)
- Windmill: graph-overlay primary — "you can graphically preview the execution of the flow as a directed acyclic graph, along with the results and logs of each step", and "you can now pick the iteration to view directly from the graph, and for branchall, branchone, while loop and forloops, the status of the branch/iteration is displayed in the top node." (https://www.windmill.dev/docs/core_concepts/instant_preview, https://www.windmill.dev/changelog/tags/flow-editor)

### 1.7 Which is best for debugging — the actual consensus

No vendor says "graph is best" outright, but their design choices converge:

- **The graph overlay is the orientation view; the ordered list/table is the debugging view.** Step Functions' documented debugging tutorial drives you through *Table view* filters — "to view the steps that failed execution, apply the following filter: … Status = Failed" — and *Event view* filters (`Type = TaskFailed`), not through the graph. (https://docs.aws.amazon.com/step-functions/latest/dg/debug-sm-exec-using-ui.html)
- **The failure banner short-circuits all of it.** "If your state machine execution failed, the *Execution Details* page displays an error message. Choose **Cause** or **View step details**… Step Functions highlights the step that caused the error in the Step details, Graph view, and Table view tabs." A direct deep-link to the failing step is the single highest-leverage debugging affordance in the whole page. (https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html)
- **Timeline/waterfall wins when the question is "why slow", not "why wrong."** Inngest's split of queue-time vs execution-time exists precisely because a flat list can't answer latency attribution. (https://www.inngest.com/docs/platform/monitor/traces)
- **Graph alone is insufficient for loops/fan-out.** Step Functions had to bolt a "Map iteration viewer" dropdown onto the graph, and represent iterations as "nodes inside a tree view" in the table, because a single graph node can stand for 10,000 executions. (https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html)

**Practical takeaway**: ship an ordered, filterable step list as the primary surface with per-step duration bars inline (the Step Functions "Timeline column" pattern), a graph overlay for orientation, and a one-click jump from the run-level error banner to the failing step.

---

## 2. Parent / child (caused-by) run linking and navigation

### 2.1 Temporal — a first-class Relationships tab with a full tree

"Displays the full hierarchy of a Workflow Execution with all parent and child nodes displayed in a tree." (https://docs.temporal.io/web-ui)

The redesign explicitly pulled these out of the history: "Relationships (Children, Parent, Next, Previous Workflows) have been moved to their own tab." (https://temporal.io/blog/the-dark-magic-of-workflow-exploration)

Two things worth stealing:

- **Four relation kinds, not two.** *Parent* and *Children* are causal; ***Next*** and ***Previous*** are continuation links (Continue-As-New / retry / cron chaining). A run that "replaced" a prior run is a different relationship from a run that "was spawned by" it, and Temporal models both.
- **Inline child preview without navigating away.** "You can open a Child Workflow Event Group and in the summary details view its Timeline" — available in both Compact and Timeline summary detail views. (same blog URL)

Historically this was weaker: the older UI only exposed a hyperlink from the `runId` attribute of the `ChildWorkflowExecutionStarted` event, and users complained when it regressed. (https://community.temporal.io/t/missing-feature-in-latest-temporal-web-ui-navigation-to-child-workflow-execution-via-hyperlink/7422)

### 2.2 Step Functions — parent link is opt-in, and that is a design wart

Child executions started from a `Task` state are **not automatically linked**. You must thread the parent execution ID through the child's input using a magic key:

```
"AWS_STEP_FUNCTIONS_STARTED_BY_EXECUTION_ID.$": "$$.Execution.Id"
```

"You can use a special parameter named `AWS_STEP_FUNCTIONS_STARTED_BY_EXECUTION_ID` when you start an execution. If included, this association provides links in the **Step details** section of the Step Functions console. When provided, you can easily trace the executions of your workflows from starting executions to their started workflow executions." (https://docs.aws.amazon.com/step-functions/latest/dg/concepts-nested-workflows.html)

From the child side: "If your state machine execution was started by another state machine, you can view the link for the parent state machine on this tab [Execution summary → Details]." (https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html)

**Lesson: make the causal link automatic and stored server-side.** Requiring the workflow author to opt into observability is the mistake here — you get a broken back-link on exactly the workflows nobody instrumented.

For Distributed Map, there is a dedicated **Map Run Details page** that "displays all the information related to a Distributed Map state execution… view a list of all child workflow executions and access their details." Fan-out gets its own aggregate page rather than 10,000 rows in the parent. (https://docs.aws.amazon.com/step-functions/latest/dg/concepts-examine-map-run.html)

### 2.3 Airflow — two mechanisms, and the UI only sees one well

- **Dag-level dependency graph**: "Browse > DAG Dependencies tab that shows a graph of trigger and sensor relationships" — statically derived from `TriggerDagRunOperator` and `ExternalTaskSensor`. It's a *definition-level* graph, not a per-run causal link. (https://www.astronomer.io/docs/learn/cross-dag-dependencies)
- Known gap: custom sensors subclassing `ExternalTaskSensor` don't always surface in that view. (https://github.com/apache/airflow/discussions/19582)
- **Asset/dataset lineage (the modern path)**: asset-driven runs "have a Run Type of 'Asset Triggered' and include a database icon on the DAG run duration bar. The Asset Events tab of the DAG run details page lists all asset events that triggered a particular DAG run (Source Asset Events)." That is a genuine per-run "caused by" link. (https://www.astronomer.io/docs/learn/airflow-datasets)
- The Asset Graph View "shows the asset in context, including upstream producers and downstream consumers", and the Dag Graph has asset overlays with two modes — "All Dag Dependencies" and "External Conditions" (asset-triggered only). (https://airflow.apache.org/docs/apache-airflow/stable/ui.html)

### 2.4 Inngest / Trigger.dev

- Inngest: `step.invoke` spans carry "Function ID, triggering event ID, triggered run ID" with a dedicated details panel — i.e. the child run ID is an attribute on the invoking span, so the link lives at the step, not the run. (https://www.inngest.com/docs/platform/monitor/traces)
- Trigger.dev: `GET /api/v1/runs/:runId/spans/:spanId` "returns span properties, events, AI enrichment, and **triggered child runs**" — same shape: child runs hang off the span that caused them. Trigger.dev also exposes `parent` and `root` metadata on runs. (https://trigger.dev/changelog/v4-4-4, https://trigger.dev/changelog/metadata-parent-root-updates)

**Convergent design across all five: the causal edge is anchored to the *step* that caused it, and additionally surfaced as a run-level parent pointer.** Both directions are needed — step→child for "what did this step spawn", run→parent for "why am I here".

---

## 3. Steps that did NOT run

This is where Airflow is far ahead, because Airflow's scheduler materializes a task instance row for *every* task in the DAG before it knows whether it will run.

### 3.1 Airflow's full task-instance state vocabulary

All definitions verbatim from https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/tasks.html

| State | Meaning |
|---|---|
| `none` | "The Task has not yet been queued for execution (its dependencies are not yet met)" |
| `scheduled` | "The scheduler has determined the Task's dependencies are met and it should run" |
| `queued` | "The task has been assigned to an Executor and is awaiting a worker" |
| `running` | "The task is running on a worker (or on a local/synchronous executor)" |
| `success` | "The task finished running without errors" |
| `restarting` | "The task was externally requested to restart when it was running" |
| `failed` | "The task had an error during execution and failed to run" |
| `skipped` | "The task was skipped due to branching, LatestOnly, or similar" |
| `upstream_failed` | "An upstream task failed and the Trigger Rule says we needed it" |
| `up_for_retry` | "The task failed, but has retry attempts left and will be rescheduled" |
| `up_for_reschedule` | "The task is a Sensor that is in reschedule mode" |
| `deferred` | "The task has been deferred to a trigger" |
| `removed` | "The task has vanished from the Dag since the run started" |
| `awaiting_input` | Task waiting for human response in human-in-the-loop workflows (Airflow 3.1+) |

Happy path: `none` → `scheduled` → `queued` → `running` → `success`. (same URL)

Three of these encode "didn't run", each for a *different reason*, and that distinction is the whole point:

- **`skipped`** — a deliberate branch decision or condition excluded it. Not an error.
- **`upstream_failed`** — it was *prevented* from running by a failure elsewhere. Not itself an error, but a consequence of one. This is the state that stops you from chasing 40 red boxes when only one thing actually broke.
- **`removed`** — the definition changed mid-run and the task no longer exists. Handles the "workflow was edited while running" problem explicitly.

Plus `none` for "not reached yet / dependencies unmet" — distinct from skipped.

### 3.2 Airflow's colors (STATE_COLORS)

`queued` darkgray, `running` #01FF70, `success` #2ECC40, `failed` firebrick, `up_for_retry` yellow, `up_for_reschedule` turquoise, `upstream_failed` orange, `skipped` darkorchid, `scheduled` tan, `deferred` mediumpurple. Colors are user-overridable via `airflow_local_settings.py`. (https://airflow.apache.org/docs/apache-airflow/stable/howto/customize-state-colors-ui.html, https://airflow.apache.org/docs/apache-airflow/stable/_api/airflow/utils/state/index.html)

Note the deliberate separation: **failed is red, upstream_failed is orange, skipped is purple.** They are visually adjacent but never confusable. Do not paint "didn't run because upstream broke" the same red as "broke".

### 3.3 How skip propagates (needed to compute the state correctly)

Trigger rules decide whether a non-run propagates:

- `all_success` (default): "All upstream tasks are in success state" — and skips *cascade* through it, so a downstream task of a skipped task is itself marked skipped.
- `none_failed`: triggered "only when all upstream tasks have either succeeded or been skipped, but not failed" — skips do **not** cascade.
- After a branch, `none_failed_min_one_success` / `none_failed` are recommended "because unless all branches are run, at least one upstream task will always be in a skipped state."
- `one_failed`: "at least one is in the failed or `upstream_failed` state." (https://www.astronomer.io/docs/learn/airflow-trigger-rules)

### 3.4 Step Functions — "not reached" is gray, and there is no persisted row

The graph legend colors each state by status: green succeeded, red failed, blue running, **gray for not yet reached**, orange for caught error (recovered). (https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html, corroborated at https://oneuptime.com/blog/post/2026-02-12-monitor-step-functions-executions-console/view)

Crucially: because the Events table is an event log, a never-entered state produces **no events at all**. "Not run" is only visible *because the graph overlays the static definition*. In Table view and Event view, unvisited states simply do not appear. That's the structural argument for keeping a definition-graph overlay even if the list is your primary view.

A related failure mode worth noting: for Express workflows, "if you remove one or more steps from your state machine definition, Step Functions detects a mismatch between the definition and prior execution events… the **Definition**, **Graph view**, and **Table view** tabs are unavailable for executions run on previous versions." Overlay-on-definition breaks entirely if you don't version-pin the definition to the run. Standard workflows do retain definitions, Express do not. (https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html)

### 3.5 Temporal — the concept barely exists

Temporal has no static graph and no notion of a step that "didn't run": the event history only records what happened. Pending work is conveyed by animation instead — a pending activity "is dashed and animates forward to indicate its pending status." (https://temporal.io/blog/the-dark-magic-of-workflow-exploration)

### 3.6 Inngest — cancelled is gray

"Green: Completed successfully, Red: Failed, Gray: Cancelled." No skipped/pruned concept, since steps are discovered by execution rather than declared upfront. (https://www.inngest.com/docs/platform/monitor/traces)

**Design conclusion for a declarative builder** (which is Carbon's case — the graph *is* declared up front): follow Airflow. Materialize a row per node per run, and carry at minimum `skipped` (branch not taken), `upstream_failed` / `blocked` (prevented by a failure), and `pending`/`none` (not reached yet) as distinct states with distinct non-red colors.

---

## 4. Live streaming of in-progress runs

**Polling dominates. Nobody in this set uses websockets for the run view.**

### 4.1 Airflow — explicit polling with a configurable interval

`[webserver] auto_refresh_interval`, default **3 seconds**, "how frequently, in seconds, the DAG data will auto-refresh in graph or grid view when auto-refresh is turned on." Settable via `AIRFLOW__WEBSERVER__AUTO_REFRESH_INTERVAL`; added in 2.2.0. Lower values = faster refresh, higher webserver load. (https://airflow.apache.org/docs/apache-airflow/stable/configurations-ref.html, https://github.com/apache/airflow/issues/18069)

The refresh is **user-toggleable** — "You can toggle the Auto-refresh button… to on to see the status of the DAGs update in real time." (https://www.astronomer.io/docs/learn/airflow-ui). There is standing demand for a config to disable it entirely on large deployments (https://github.com/apache/airflow/discussions/22538).

A real, instructive bug: with auto-refresh on, grid task ordering churned between polls, making the UI unusable — "Grid View: Task order rearranges constantly with auto-refresh on." (https://github.com/apache/airflow/issues/23542) **Lesson: a polled refresh must produce a stable ordering and stable React keys, or it destroys the view under the user's cursor.**

### 4.2 Temporal — "Liveness", implemented as poll-and-diff

"Workflows update in real-time. As new Events return from the Temporal cluster, every view is updated to show the current state." The UI refetches history and re-renders every view; there is no push channel from the server to the browser for history. (https://temporal.io/blog/the-dark-magic-of-workflow-exploration)

Where Temporal *does* do push, it's for application data, not the UI: Workflow Streams use long-polling over the Update primitive — "All events are numbered, and the client always passes the last received event to the Update handler. If the Workflow has any newer stream events, it returns immediately. If not, the Update handler waits until more events become available." Default batch interval 2 seconds, tightened to 100 ms for AI streaming, "which is responsive enough for a UI." (https://temporal.io/blog/workflow-streams-live-interactivity-agents-other-applications)

**The 100ms-vs-2s note is a useful calibration**: sub-second is only needed for token-streaming; 2–3s is the accepted norm for run status.

### 4.3 Step Functions — no documented auto-refresh

The console docs describe manual navigation and an event history paged at 25 events per page; nothing about live streaming. In practice the page is refetched on navigation. Given "Maximum execution time: 1 year", live streaming a run is not the primary use case. (https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html, https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html)

Note the API-side constraint on any polling design: `DescribeExecution` throttles at bucket 300 / refill 15 per second (large regions); `GetExecutionHistory` at bucket 400 / refill 20 per second. Polling budgets are a real quota consideration. (https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html)

### 4.4 Standard behavior to adopt

1. Poll on an interval, **2–5 seconds**, matching Airflow's 3s default and Temporal's 2s batch.
2. Make it a **user-visible toggle**, defaulted on.
3. **Stop polling once the run reaches a terminal state** — otherwise you pay forever for finished runs.
4. Guarantee **stable ordering and stable keys** across polls (the Airflow #23542 lesson).
5. Only fetch the delta (events after last seen ID), not the whole history — Temporal's stream cursor pattern.

---

## 5. Payload storage, truncation, and "too large" handling

### 5.1 Hard limits in the wild

| System | Limit | Source |
|---|---|---|
| Step Functions | **256 KiB** max input or output size for a task, state, or execution, as a UTF-8 string. Hard quota, cannot be raised. | https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html |
| Step Functions | **1 MB** max request size (total per API request incl. headers); **1 MB** max state machine definition | same |
| Step Functions | **25,000 events** max execution history for Standard; execution *fails* on exceeding. Express: unlimited but history lives in CloudWatch. | same |
| Step Functions | History retention **90 days** (Standard, reducible to 30 on request); Express default window **3 hours** of CloudWatch Logs | same + https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html |
| Temporal | Payload **warn at 256 KB, error at 2 MB** (`ErrBlobSizeExceedsLimit`); 2 MB on Cloud, configurable self-hosted with 2 MB default | https://docs.temporal.io/troubleshooting/blob-size-limit-error |
| Temporal | gRPC message limit **4 MB** per request | https://docs.temporal.io/cloud/limits |
| Temporal | Event History transaction limit **4 MB** | https://docs.temporal.io/cloud/limits |
| Temporal Cloud | Event History **51,200 events (warn at 10,240)** and **50 MB (warn at 10 MB)** | https://docs.temporal.io/cloud/limits |
| Inngest | **4 MB** max data returned by a step; *total across all steps* must be under 4 MB | https://www.inngest.com/docs/usage-limits/inngest |
| Inngest | Function run **state cannot exceed 32 MB** (events + step data + function return + internal metadata) | same |
| Inngest | Event payload: 256 KiB Free / 512 KiB Basic / 3 MiB Pro; **1000 steps max** per function | same |
| Trigger.dev | **512 KB** — payloads and outputs above this are transparently offloaded to object storage; batch items offloaded above 128 KB | https://trigger.dev/docs/limits |
| Airflow XCom | Backend-bound: MySQL **64 KB** (BLOB), Postgres ~1 GB, SQLite ~2 GB — no application-level cap | https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/xcoms.html |

### 5.2 The three strategies, in order of how well they work

**(a) Hard cap and fail loudly — Step Functions.** 256 KiB, no exceptions, no offload, no truncation. The execution errors. This is brutal but produces zero ambiguity: you never look at a payload in the console and wonder if it's the real one. AWS's documented mitigation is architectural, not UI: pass S3 ARNs instead of data.

**(b) Warn-then-error two-tier — Temporal.** Warn at 256 KB, hard error at 2 MB. The warning band is the good idea: it gives operators a window to fix payload growth before workflows start failing in production. Temporal Cloud repeats the pattern on history size (warn at 10,240 events / 10 MB, fail at 51,200 / 50 MB).

**(c) Transparent claim-check offload — Trigger.dev, and Temporal's External Storage.**
- Trigger.dev: "Payloads and outputs that exceed 512KB will be offloaded to object storage and a presigned URL will be provided to download the data when calling `runs.retrieve`… You don't need to do anything to handle this in your tasks, as the system will transparently upload/download these during operation." (https://trigger.dev/docs/limits)
- Temporal: "Offload large payloads to an object store to reduce the risk of exceeding payload size limits" by passing references — "the most reliable way to avoid hitting payload size limits." Built into the SDKs as **External Storage**, or hand-rolled via a **custom Payload Codec**. Compression via codec is explicitly flagged as a stopgap: "potentially temporary if payload sizes continue growing." (https://docs.temporal.io/troubleshooting/blob-size-limit-error)
- Airflow: the same idea as a pluggable backend — "The XCom system has interchangeable backends… set which backend is being used via the `xcom_backend` configuration option… subclass `BaseXCom`, and override the `serialize_value` and `deserialize_value` methods." (https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/xcoms.html)

### 5.3 The decode/display hook — Temporal's Codec Server

Worth knowing even if you don't encrypt: Temporal solves "the UI must render a payload the server cannot read" by putting the decode step **in the browser**. "A Codec Server is an HTTP server that provides remote encoding and decoding for Temporal Payloads, enabling the Web UI and CLI to display decoded data without exposing encryption keys to the Temporal Service." The browser calls the codec's `/decode` endpoint directly via fetch/XHR; "the Temporal Web server will never see the decoded Payloads and does not need to be able to connect to the codec server." Configured with `TEMPORAL_CODEC_ENDPOINT`; requires CORS. (https://docs.temporal.io/codec-server, https://docs.temporal.io/production-deployment/data-encryption)

### 5.4 Bounding the *history*, not just the payload

Two mechanisms, both worth copying:

- **Cap event count and fail the run.** Step Functions: 25,000 events, execution fails; documented remedy is "Starting new executions to avoid reaching the history quota." The console helpfully "displays the total event count, which can help you determine if you exceeded the maximum event history count of 25,000 events." (https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html)
- **Time-bound retention.** 90 days Standard / 3 hours default for Express-via-CloudWatch. Express also has a cost warning attached to widening the window: "If you specify a larger time range that includes more execution events, your costs will increase." Retention windows are a first-class product decision, not an implementation detail. (same URL)

### 5.5 Recommended posture

1. Store a **small inline payload** per step (a few hundred KB ceiling — everyone converges near 256–512 KB).
2. **Warn well before the hard limit** (Temporal's 256 KB warn / 2 MB error two-tier).
3. Above the threshold, **offload to object storage and store a reference**, transparently — Trigger.dev's 512 KB rule is the cleanest model, and the UI fetches on demand rather than eagerly.
4. In the UI, **render a truncated preview with an explicit "truncated / view full payload" affordance** — never silently show a partial payload.
5. Bound the **step/event count** per run and surface the running count in the UI so operators can see themselves approaching it.
6. Set an explicit **retention window** and make the cost of widening it visible.

---

## Appendix: Source index

**Step Functions**
- https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html
- https://docs.aws.amazon.com/step-functions/latest/dg/debug-sm-exec-using-ui.html
- https://docs.aws.amazon.com/step-functions/latest/dg/concepts-nested-workflows.html
- https://docs.aws.amazon.com/step-functions/latest/dg/concepts-examine-map-run.html
- https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html
- https://aws.amazon.com/blogs/compute/debugging-aws-step-functions-executions-with-the-new-console-experience

**Temporal**
- https://docs.temporal.io/web-ui
- https://temporal.io/blog/the-dark-magic-of-workflow-exploration
- https://docs.temporal.io/cloud/limits
- https://docs.temporal.io/troubleshooting/blob-size-limit-error
- https://docs.temporal.io/codec-server
- https://docs.temporal.io/production-deployment/data-encryption
- https://temporal.io/blog/workflow-streams-live-interactivity-agents-other-applications
- https://community.temporal.io/t/missing-feature-in-latest-temporal-web-ui-navigation-to-child-workflow-execution-via-hyperlink/7422

**Airflow**
- https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/tasks.html
- https://airflow.apache.org/docs/apache-airflow/stable/ui.html
- https://airflow.apache.org/docs/apache-airflow/stable/configurations-ref.html
- https://airflow.apache.org/docs/apache-airflow/stable/howto/customize-state-colors-ui.html
- https://airflow.apache.org/docs/apache-airflow/stable/_api/airflow/utils/state/index.html
- https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/xcoms.html
- https://airflow.apache.org/blog/airflow-3.1.0/
- https://github.com/apache/airflow/issues/23542
- https://github.com/apache/airflow/issues/18069
- https://github.com/apache/airflow/discussions/22538
- https://www.astronomer.io/docs/learn/airflow-trigger-rules
- https://www.astronomer.io/docs/learn/cross-dag-dependencies
- https://www.astronomer.io/docs/learn/airflow-datasets
- https://www.astronomer.io/docs/learn/airflow-ui

**Inngest**
- https://www.inngest.com/docs/platform/monitor/traces
- https://www.inngest.com/docs/platform/monitor/inspecting-function-runs
- https://www.inngest.com/docs/usage-limits/inngest
- https://www.inngest.com/blog/enhanced-observability-traces-and-metrics
- https://www.inngest.com/changelog/2025-03-07-new-runs-view

**Trigger.dev / Windmill**
- https://trigger.dev/docs/runs
- https://trigger.dev/docs/limits
- https://trigger.dev/changelog/run-page-timeline
- https://trigger.dev/changelog/v4-4-4
- https://trigger.dev/changelog/metadata-parent-root-updates
- https://www.windmill.dev/docs/core_concepts/instant_preview
- https://www.windmill.dev/changelog/tags/flow-editor
# Redaction and Retention of Workflow Execution Logs

Research date: 2026-07-31. Scope: redaction and retention of automation/workflow
execution logs that may contain customer business data. Sources: OWASP, NIST/OMB,
GDPR text, and published implementations (Sentry, Datadog, Elastic APM, Rails,
OpenTelemetry, Google Cloud DLP), plus comparable products (Stripe, GitHub, Svix,
Zapier, n8n, Temporal).

---

## 1. Redact-by-key-name: the published denylists

The dominant industry pattern is **key-name denylisting**, not value scanning:
you match the *field name* and replace the *value* with a fixed placeholder,
keeping the key visible so operators can tell that a field existed.

### 1.1 Sentry — Python SDK `EventScrubber` (the most complete published list)

Source: <https://getsentry.github.io/sentry-python/_modules/sentry_sdk/scrubber.html>

`DEFAULT_DENYLIST`:

```
password, passwd, secret, api_key, apikey, auth, credentials, mysql_pwd,
privatekey, private_key, token, session, csrftoken, sessionid, x_csrftoken,
x_forwarded_for, set_cookie, cookie, authorization, proxy-authorization,
x_api_key, aiohttp_session, connect.sid, csrf_token, csrf, _csrf, _csrf_token,
PHPSESSID, _session, symfony, user_session, _xsrf, XSRF-TOKEN
```

`DEFAULT_PII_DENYLIST`:

```
x_forwarded_for, x_real_ip, ip_address, remote_addr
```

Replacement value: `"[Filtered]"`.

### 1.2 Sentry — server-side / Relay default data scrubber

Source: <https://docs.sentry.io/security-legal-pii/scrubbing/server-side-scrubbing/>

Server-side default keyname list (shorter, substring-matched):

```
password, secret, passwd, api_key, apikey, auth, credentials, mysql_pwd,
privatekey, private_key, token, bearer
```

Plus two value-based rules applied automatically:

- credit-card-looking values (basic regex)
- optional IP-address suppression

Sentry documents the *substring* behaviour explicitly: an added entry `mysekret`
"will cause the removal of any field named `mysekret`, but also removes any field
**value** that contains `mysekret`."

### 1.3 Sentry — SDK spec (matching semantics)

Source: <https://develop.sentry.dev/sdk/foundations/data-scrubbing/>
and <https://docs.sentry.io/platforms/javascript/data-management/data-collected/>

- Denylist matching is documented as **"partial, case-insensitive match"**.
- PII denylist uses fragment patterns like `x-forwarded-`, `-user`, `-ip`,
  `remote-`, `via`, `forwarded`.
- Headers are sent by default with sensitive **values** scrubbed and **keys
  retained**. Cookies are not sent by default. Request/response **bodies are not
  sent by default** (only `content-length`).

### 1.4 Elastic APM — `sanitize_field_names` (cross-agent spec)

Source: <https://github.com/elastic/apm/blob/main/specs/agents/sanitization.md>
Node agent config: <https://www.elastic.co/docs/reference/apm/agents/nodejs/configuration>

Minimum default across all agents (wildcard patterns):

```
password, passwd, pwd, secret, *key, *token*, *session*, *credit*, *card*,
*auth*, set-cookie, *principal*
```

Agents may add: `pw, pass, connect.sid, cookie`.

Key spec details worth copying:

- `*` is a wildcard; matching is via a `WildcardMatcher` (patterns like `*token*`
  are explicitly substring-style).
- **"If a payload field's name matches a configured wildcard, that field's value
  must be redacted and the key itself must still be reported."** — keep the key.
- Replacement **"SHOULD be `[REDACTED]`"**.
- Applies to: HTTP request/response headers, cookies, and
  `application/x-www-form-urlencoded` form fields.
- Explicitly **does not** apply to query strings or JSON request bodies
  ("SHOULD NOT be sanitized") — i.e. Elastic's position is that you don't
  key-scrub arbitrary bodies, you decide separately whether to capture them at all.

### 1.5 Rails — `config.filter_parameters`

Source: <https://guides.rubyonrails.org/configuring.html>

Default generated initializer:

```ruby
Rails.application.config.filter_parameters += [
  :passw, :email, :secret, :token, :_key, :crypt, :salt,
  :certificate, :otp, :ssn, :cvv, :cvc
]
```

- Docs state: **"Parameters filter works by partial matching regular expression."**
  (`:passw` therefore covers `password`, `passwd`, `password_confirmation`.)
- Same filter is applied to ActiveRecord `#inspect`, i.e. it protects both request
  logs and object dumps.
- Replacement is `[FILTERED]`.

Note the design choice: Rails ships **stems** (`:passw`, `:_key`, `:crypt`) rather
than exhaustive full names, relying on substring matching to cover variants.

### 1.6 Datadog — published scrubbing rules

Source: <https://docs.datadoghq.com/logs/guide/commonly-used-log-processing-rules/>

Datadog does not ship a key-name denylist; it ships **named regex rules** with
per-rule replacement text:

| Rule | Replacement |
|---|---|
| `social_security_number_basic` | `[SSN REDACTED]` |
| `RFC_5322_email` | `[EMAIL REDACTED]` |
| `visa_mc_amex_diners_discover_jcb_credit_card` | `[CREDIT CARD REDACTED]` |
| `postal_codes` | `[POSTAL CODE REDACTED]` |
| `simple_ip_address` | `[IP REDACTED]` |
| `redact_key_match_letters_numbers_spaces_unders` | `my_key=[VALUE REDACTED]` |
| `exclude_sensitive_info` | log dropped entirely (`exclude_at_match`) |

Two rule types only: `exclude_at_match` (drop the whole record) and
`mask_sequences` (replace the matched span).

Sensitive Data Scanner (the managed product) offers a rule library covering
"email addresses, credit card numbers, API keys, authorization tokens, network and
device information", with two remediations: **hash** (non-reversible token,
preserves cardinality for analytics) or **scrub** (fixed replacement string).
Sources: <https://docs.datadoghq.com/security/sensitive_data_scanner/scanning_rules/>,
<https://www.datadoghq.com/blog/sensitive-data-scanner/>

### 1.7 OpenTelemetry

Source: <https://opentelemetry.io/docs/specs/semconv/http/http-spans/>

- OTel does **not** capture HTTP headers by default. "Instrumentations SHOULD
  require an explicit configuration of which headers are to be captured", because
  "including all request headers can be a security risk".
- `url.full` MUST NOT contain URL-embedded credentials; username/password SHOULD
  be redacted.
- Where a sanitize list exists (e.g. Java agent
  `OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_SANITIZE_FIELDS`), it is a
  comma-delimited list of header names, regexes allowed, and **"all header names
  will be matched in a case-insensitive manner."**

Takeaway: OTel's stance is *allowlist headers*, not denylist them.

### 1.8 Google Cloud Sensitive Data Protection (DLP)

Source: <https://cloud.google.com/dlp/docs/infotypes-reference>,
<https://docs.cloud.google.com/sensitive-data-protection/docs/redacting-sensitive-data>

Value-based `infoType` detectors (`CREDIT_CARD_NUMBER`, `US_SOCIAL_SECURITY_NUMBER`,
`AUTH_TOKEN`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, …). Useful as a second layer, but
expensive and lossy compared to key-name matching; treat as defence-in-depth.

### 1.9 A practical merged denylist

Union of the above, normalised (lowercase, `-`/`_` folded), substring-matched:

```
Auth / credentials:
  authorization, proxy-authorization, www-authenticate, bearer, auth, credential,
  credentials, password, passwd, pwd, passw, secret, client_secret, client-secret,
  token, access_token, refresh_token, id_token, id_key, api_key, apikey, x-api-key,
  x_api_key, apisecret, private_key, privatekey, public_key, signature, signing,
  hmac, salt, crypt, certificate, mysql_pwd, otp, mfa, pin

Session / CSRF:
  cookie, set-cookie, session, sessionid, _session, connect.sid, phpsessid,
  csrf, _csrf, csrf_token, csrftoken, x_csrftoken, xsrf, _xsrf, xsrf-token,
  user_session, aiohttp_session, symfony

Payment / identity:
  card, credit, creditcard, cardnumber, pan, cvv, cvc, cvv2, cav2, track_data,
  ssn, sin, nino, tax_id, taxid, passport, dob, date_of_birth, iban, account_number,
  routing_number

Network PII:
  x-forwarded-for, x_forwarded_for, x-real-ip, x_real_ip, ip_address, remote_addr
```

Caveats to encode as deliberate decisions:

- `email` is in Rails' default list but **not** in Sentry's or Elastic's. In a B2B
  ERP the email of a supplier contact is business data an operator legitimately
  needs when debugging a run; consider excluding it from the denylist and relying
  on retention + access control instead. Document the choice either way.
- Substring matching produces false positives: `token_count`, `keyword`,
  `authority`, `cardinality`, `discard`, `secretary`. Elastic solves this with
  explicit wildcards (`*key` anchors to the end, `*token*` is free-floating), which
  is a better default than blind `includes()`.

---

## 2. Matching semantics: case, substring, nesting, arrays

### 2.1 Case sensitivity

Unanimously **case-insensitive** in practice.

- Sentry Python: the denylist is lowercased at construction
  (`self.denylist = [x.lower() for x in self.denylist]`) and matched as
  `k.lower() in self.denylist`.
  <https://getsentry.github.io/sentry-python/_modules/sentry_sdk/scrubber.html>
- Sentry SDK spec: "partial, case-insensitive match".
  <https://develop.sentry.dev/sdk/foundations/data-scrubbing/>
- OTel Java header sanitize fields: "all header names will be matched in a
  case-insensitive manner."
  <https://opentelemetry.io/docs/specs/semconv/http/http-spans/>

Also normalise separators: HTTP headers arrive as `X-Api-Key`, JSON keys as
`x_api_key` or `apiKey`. Fold to lowercase and strip `-`/`_` before comparing, or
you will miss `Set-Cookie` vs `set_cookie` (note Sentry's Python list contains
*both* spellings precisely because it does exact matching).

### 2.2 Exact vs substring — implementations disagree, and it matters

| Implementation | Match style |
|---|---|
| Sentry Python SDK (`EventScrubber`) | **exact** key match against a 30+ entry list |
| Sentry server-side (Relay) | **substring** — matches key *and* value |
| Sentry SDK spec / JS docs | **partial (substring), case-insensitive** |
| Rails `filter_parameters` | **partial regex** (substring) |
| Elastic APM | **wildcard glob** (`*key`, `*token*`) — anchored where it matters |

The trade-off is explicit: exact matching needs a long, exhaustively enumerated
list and will miss `stripe_api_key`; substring matching needs a short list of stems
but over-redacts. **Elastic's anchored wildcards are the best-documented middle
ground** and are worth copying (`password`, `*key`, `*token*`, `*secret*`,
`set-cookie`).

### 2.3 Nested objects and arrays

Sentry Python (`scrub_dict` / `scrub_list`) is the clearest published algorithm:

- `scrub_dict(d)`: for each `k, v` — if `k.lower()` is denylisted, replace `v` with
  `"[Filtered]"`; else if `recursive` and `v` is a dict/list, recurse.
- `scrub_list(lst)`: call `scrub_dict` on each element, then recurse into nested
  lists.
- Recursion into nested containers is **opt-in** (`recursive=False` by default) —
  Sentry limits full traversal to specific event sections (`request.headers`,
  `request.cookies`, `request.data`, `extra`, `user`, `breadcrumbs`, frame locals,
  span data) for performance.

Source: <https://getsentry.github.io/sentry-python/_modules/sentry_sdk/scrubber.html>

Elastic APM's spec applies patterns recursively over header/cookie/form maps but
deliberately stops at JSON bodies (§1.4).

OTel: attribute value length limits "appl[y] recursively to array elements and map
values"; numeric values are never truncated.
<https://opentelemetry.io/docs/specs/otel/common/>

Practical rules to implement:

1. Arrays inherit the parent key's verdict — if the key `tokens` is denylisted, the
   whole array is replaced with a single `"[REDACTED]"`, not per-element.
2. Array **elements** are scrubbed by index-independent recursion (index is never
   a key name, so never matched).
3. Cap recursion depth (Sentry caps traversal to known sections; OTel caps
   attribute count at 128). A hard depth cap (e.g. 8) plus a node-count cap
   prevents pathological payloads from stalling the writer.
4. Cycles: guard with a seen-set — workflow run contexts are frequently built by
   merging objects and can self-reference.

---

## 3. Outbound webhooks: why response bodies and request headers are not stored

### 3.1 The published guidance

OWASP Webhook Security Guidelines cheat sheet (draft) —
<https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets_draft/Webhook_Security_Guidelines_Cheat_Sheet.md>

**What to log:** "Timestamp, source IP, HTTP method, response status, event ID,
event type, and processing latency."

**What NOT to log, explicitly:**

- full request bodies (may contain PII)
- signing secrets ("treat like database credentials")
- raw `Authorization` header values
- stack traces / verbose error detail (server-side only)

OWASP Logging cheat sheet —
<https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html> —
"data to exclude" list: application source code, session identification values,
access tokens, sensitive personal data/PII, authentication passwords, database
connection strings, encryption keys and other primary secrets, bank account or
payment card holder data, data of a higher security classification than the
logging system, commercially-sensitive information, information illegal to
collect, and information the user opted out of.

### 3.2 The specific arguments for *outbound* webhook calls

1. **Request headers are where the credential lives.** For an outbound webhook the
   entire point of the request headers is to carry `Authorization: Bearer …`,
   `X-API-Key`, `X-Signature`, or a customer-supplied custom header. Storing them
   is storing a live credential in a queryable table. OWASP calls out "raw
   `Authorization` header values" by name. Even redacted, the marginal debugging
   value is near zero — the operator already knows which credential was configured.
2. **Response bodies are third-party-controlled and unbounded.** You have no
   schema, no size guarantee, and no idea what the remote system echoes back. Many
   APIs echo the full submitted record (including PII) in their 200 response.
   Webhook security guidance frames this as trust transfer: "when integrating with
   third-party SaaS platforms, you are trusting their security practices"
   (<https://www.obsidiansecurity.com/blog/what-is-webhook-security-securing-saas-integrations-2026>).
   Storing that body imports their data-classification problems into your database
   and your retention obligations.
3. **Response bodies also carry secrets.** Error responses commonly include the
   echoed request (with the auth header), a session token, or a signed URL.
   Key-name redaction can't help you here because the body may not be JSON.
4. **Data proliferation beyond intended retention.** "Data synchronized via
   webhooks may persist in downstream systems beyond intended retention periods"
   (<https://hookdeck.com/webhooks/guides/webhook-security-vulnerabilities-guide>)
   — the log is exactly such a downstream system.
5. **Response bodies are attacker-influenceable in an SSRF context.** The same
   cheat sheet's SSRF section requires validating callback URLs and blocking
   internal ranges/cloud IMDS. If SSRF defence ever fails, a stored response body
   turns a blind SSRF into a full read primitive that is durably persisted and
   readable through your own UI.

### 3.3 What *is* considered safe to store

Consensus safe set for an outbound HTTP step:

- destination host (and optionally path; **strip query string** — OTel notes
  credentials in URLs must be redacted)
- HTTP method
- response **status code** and status class
- **duration** / latency in ms
- attempt number, retry count, final disposition
- error **classification** (DNS failure, TLS failure, timeout, 4xx, 5xx) and a
  short error message
- a **short excerpt** of the response body — bounded (e.g. first 200–500 chars),
  redaction-passed, and clearly marked as truncated — solely so an operator can see
  `{"error":"invalid_customer_id"}` without storing a 2 MB payload
- content-length / content-type (Sentry stores `content-length` for bodies it
  refuses to store: <https://docs.sentry.io/platforms/javascript/data-management/data-collected/>)

Real product behaviour confirms this is a spectrum, not a rule:

- **GitHub** *does* store request headers, payload, and the response — but for only
  **3 days** (reduced from longer windows in Oct 2023). The short window is the
  compensating control.
  <https://github.blog/changelog/2023-10-17-webhook-delivery-logs-will-only-be-retained-for-3-days/>,
  <https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries>
- **Svix** stores the *outbound payload* for 90 days by default (30 on free tier,
  configurable per-message via `payload_retention_period`), and offers enterprise
  deletion of payloads **on successful delivery**. Metadata outlives the payload.
  <https://docs.svix.com/retention>

So: short retention is an acceptable substitute for not storing at all — but
"short" means days, not months, and it should be a deliberate, documented tier.

---

## 4. Retention tiering: full detail short, summary long

### 4.1 The three-tier pattern, as published

**Stripe** is the cleanest commercial example of *degrading detail over time*
rather than deleting outright —
<https://support.stripe.com/questions/stripe-event-retention-period>:

| Window | What you get |
|---|---|
| 0–30 days | **fully visible** via API and Dashboard |
| 30 days – 13 months (live mode) | **summary view only** in the Dashboard |
| > 13 months | gone |
| API `Retrieve Event` / `List Events` | **30 days only** |

Test mode: 90 days in Dashboard, same 30-day full-detail threshold.

**OMB M-21-31** (US federal, the canonical published *tiered* retention mandate) —
<https://www.splunk.com/en_us/blog/learn/m-21-31-cybersecurity.html>,
<https://docs.cloud.gov/platform/compliance/m-21-31-compliance/>,
<https://aws.amazon.com/blogs/publicsector/aws-federal-customers-memorandum-m-21-31/>:

| Tier | Total retention | Hot / active |
|---|---|---|
| EL1 | 12 months | 30 days active-queryable |
| EL2 | 18 months | 60 days hot |
| EL3 | 30 months | 12 months active + 18 months cold |

The structural idea to copy: **retention window and query-tier are separate
dimensions.** Full-fidelity/hot is measured in days-to-weeks; the record's
existence is measured in months.

**NIST SP 800-92** (Guide to Computer Security Log Management) — the standard
underpinning: define retention per log category, archive on a schedule, rotate
automatically, protect integrity, and destroy beyond the required window.
<https://nvlpubs.nist.gov/nistpubs/legacy/sp/nistspecialpublication800-92.pdf>,
<https://csrc.nist.gov/pubs/sp/800/92/r1/ipd> (Rev. 1 draft, explicitly scoped to
"the scope of log information, log retention duration, log protection methods").

### 4.2 Comparable automation products

| Product | Detail retention | Notes |
|---|---|---|
| **Zapier** Zap history | ~30 days default (29–69 in practice due to monthly cleanup cycle); max 60 days guaranteed; 10,000 runs displayed; Enterprise can shorten to **7–30 days** | Export recommended for longer records. <https://help.zapier.com/hc/en-us/articles/8496327478413-Customize-data-retention-in-Zapier> |
| **n8n** execution data | Pruned when **older than `EXECUTIONS_DATA_MAX_AGE` (default 336 h = 14 days)** *or* count > `EXECUTIONS_DATA_PRUNE_MAX_COUNT` (default 10,000). Soft-delete then hard-delete, with a 1 h `EXECUTIONS_DATA_HARD_DELETE_BUFFER`. Annotated executions are never pruned. | Also has `EXECUTIONS_DATA_SAVE_ON_SUCCESS` to skip storing successful-run data at all. <https://docs.n8n.io/hosting/scaling/execution-data/> |
| **Temporal Cloud** | Namespace retention default **30 days**, settable 1–90 | Payload blob limit 2 MB, history transaction 4 MB. <https://docs.temporal.io/cloud/limits> |
| **Svix** | Payload 90 days (30 free), per-message override; metadata longer | <https://docs.svix.com/retention> |
| **GitHub webhooks** | 3 days for full delivery detail | <https://github.blog/changelog/2023-10-17-webhook-delivery-logs-will-only-be-retained-for-3-days/> |

### 4.3 A defensible three-tier design for run history

Synthesising Stripe + OMB + n8n:

| Tier | Contents | Suggested window |
|---|---|---|
| **T1 — full detail** | per-node input/output payloads (redacted + compacted), HTTP excerpts, evaluated conditions, error payloads | 7–30 days |
| **T2 — summary** | per-run and per-node status, timings, node type, error class + message, entity refs `{type, id}`, counts | 90 days – 13 months |
| **T3 — header/index** | run id, workflow id + version, trigger event, started/finished, final status, actor | 13 months – 7 years (align with the ERP's own audit-record retention) |

Two implementation notes:

- Tier transitions should be **destructive at the column level** (null out the
  payload JSON, keep the row), which is what Stripe's "summary view" and Svix's
  payload deletion effectively are. That makes the downgrade cheap and idempotent.
- n8n's `EXECUTIONS_DATA_SAVE_ON_SUCCESS` is worth mirroring: a per-workflow or
  per-tenant switch to skip T1 entirely for successful runs, keeping full detail
  only for failures. It is the single biggest storage and privacy lever.

---

## 5. Compaction: truncation markers and list head-truncation

There is no single standard, but there are strong, widely-recognised conventions.

### 5.1 Node.js `util.inspect` — the most-copied convention

Source: <https://nodejs.org/api/util.html>. Verified against Node locally:

```
maxArrayLength  default 100   →  [ 0, 0, …, 0, ... 56 more items ]
maxStringLength default 10000 →  'xxxxxxxxxxxxxxxxxxxx'... 10030 more characters
Map/Set                       →  { 98 => 98, 99 => 99, ... 20 more items }
```

Exact marker strings: `... N more items` and `... N more characters`. This is the
format every JS developer already reads correctly, and it is the strongest
argument for adopting `... N more items` verbatim rather than inventing one.

### 5.2 OpenTelemetry — truncate silently, no marker

Source: <https://opentelemetry.io/docs/specs/otel/common/>

- `AttributeCountLimit` default **128**; `AttributeValueLengthLimit` default
  **Infinity** (SDK-configurable; common values in practice 256/512/1024/4096).
- Over-length strings and byte arrays are truncated "so that its length is at most
  equal to the limit"; over-count attributes are **discarded**.
- Limits apply **recursively** to array elements and map values. Numerics untouched.
- **No marker is added.** "There MAY be a log emitted to indicate to the user that
  an attribute was truncated or discarded", at most once per record.

This is the anti-pattern to avoid for user-facing run history: silent truncation
with no in-band signal is fine for telemetry, terrible for a debugging UI where the
operator must know whether they are seeing the whole value.

### 5.3 Sentry — configurable caps

Source: <https://docs.sentry.io/platforms/javascript/configuration/options/>,
Sentry help centre articles on truncation.

- `maxValueLength`: default **250** in JS SDKs, **1024** in Python.
- Hard server-side limit **8192 characters** regardless of `maxValueLength`.
- `maxBreadcrumbs`: default **100**.
- `maxRequestBodySize`: `none` / `small` / `medium` / `always`.

Notable: Sentry's caps are *low*. 250 chars is enough to identify a value, not to
reconstruct it — which is the right target for a run-history excerpt.

### 5.4 Redaction placeholder conventions

| System | Placeholder |
|---|---|
| Elastic APM spec | `[REDACTED]` ("SHOULD be", alternatives allowed if consistent and non-revealing) |
| Sentry | `[Filtered]` |
| Rails | `[FILTERED]` |
| Datadog | `[SSN REDACTED]`, `[EMAIL REDACTED]`, `[CREDIT CARD REDACTED]` (typed) |
| GitHub Actions | `***` (each whitespace-separated masked token replaced with `*`) — <https://docs.github.com/en/actions/reference/security/secure-use> |

Elastic's spec adds the rule that matters most: the placeholder must be
**non-revealing** (must not leak length or content) and **consistent** (so it is
greppable and so operators learn to recognise it).

### 5.5 Recommended marker set

```
Redacted value          "[REDACTED]"
Truncated string        "…" + " … N more characters"      (or `"<value>… (N more chars)"`)
Truncated array         first K items + "… N more items"
Dropped by size budget  "[TRUNCATED: payload exceeded N KB]"
Dropped by depth        "[TRUNCATED: max depth]"
Binary / non-JSON       "[BINARY: content-type, N bytes]"
```

Conventions worth enforcing:

- Markers are **strings in the data**, so they must be unambiguous vs. real user
  content. Bracketed all-caps sentinels (`[REDACTED]`) are the de-facto convention
  precisely because they are visually distinct.
- Always report the **count** of what was dropped (`N more items`), not just that
  something was dropped — the operator needs to know if the list had 3 or 30,000.
- **Keep the key** when redacting a value (Elastic spec, §1.4). Deleting the key
  destroys the shape of the payload and makes debugging harder.
- Apply a **total byte budget per run record** in addition to per-field caps
  (Temporal's 2 MB payload / 4 MB transaction limits are the reference points:
  <https://docs.temporal.io/cloud/limits>). Per-field caps alone don't bound a
  payload with 10,000 small fields.
- Order of operations: **redact → truncate → size-budget**. Redacting after
  truncation risks a secret being split across the boundary and surviving.

---

## 6. GDPR / data minimisation, and why `{type, id}` beats a row snapshot

### 6.1 The controlling text

GDPR Article 5(1)(c) — data minimisation
(<https://gdpr-info.eu/art-5-gdpr/>):

> "adequate, relevant and limited to what is necessary in relation to the purposes
> for which they are processed"

GDPR Article 5(1)(e) — storage limitation:

> "kept in a form which permits identification of data subjects for no longer than
> is necessary for the purposes for which the personal data are processed"

Recital 39 adds that the storage period should be "limited to a strict minimum"
and that time limits should be established for erasure or periodic review.

Two independent constraints: minimisation caps the **width** of what you capture
at write time; storage limitation caps its **depth in time**. A run-history design
must answer both, separately.

### 6.2 Why logs are the classic failure mode

Regulator-facing commentary consistently flags retention failure — "old CVs,
abandoned accounts, **log files kept forever**" — as the most common Article 5
violation, and the EDPB's 2025 coordinated enforcement action (published Feb 2026)
found persistent weaknesses in "systematic internal data classification" and "lack
of automated deletion capabilities."
<https://www.legiscope.com/blog/gdpr-data-minimisation-storage-limitation-official.html>

Practical consequence: an unbounded `workflow_run_step.output_json` column is a
shadow copy of the ERP that (a) nobody classified, (b) nobody deletes, and (c) no
DSAR/erasure process reaches.

### 6.3 Why `{type, id}` is the safer design

Storing a **reference** — `{ "type": "salesOrder", "id": "SO-00123" }` — instead of
a row snapshot has five concrete advantages:

1. **Minimisation, by construction.** The reference is the minimum necessary to
   satisfy the purpose ("which record did this run act on?"). A row snapshot
   includes fields the log's purpose never required — contact names, emails,
   addresses, prices — failing the Article 5(1)(c) "strict necessity" test. The
   EDPB/CJEU standard is necessity, not usefulness.
2. **Erasure propagates for free.** If the customer contact is deleted or
   rectified in the source table, the log automatically stops surfacing stale
   personal data, because it never held a copy. With snapshots you must fan out
   erasure into every historical run record — which is exactly the "systematic
   deletion capability" that DPAs find missing. (Note the important nuance: a
   reference is **pseudonymised**, not anonymised — the ID plus the live table
   still identifies a person, so the log still holds personal data in the legal
   sense. It just holds *far less* of it, and holds it in a form where erasure at
   the source is effective.
   <https://growth-onomics.com/legal-duties-for-pseudonymized-data-under-gdpr/>)
3. **Accuracy (Article 5(1)(d)).** A snapshot silently rots and starts asserting
   facts about a person that are no longer true; a reference always resolves to
   current truth.
4. **Access control composes.** A reference is resolved at read time through the
   same RLS / `companyId` scoping and permission checks as the underlying record,
   so run history cannot become a permission-bypass side channel. A denormalised
   snapshot bypasses the source table's authorisation entirely.
5. **Storage and blast radius.** References are ~50 bytes vs. multi-KB rows;
   a breach of the run-history table yields IDs, not a dump of customer records.

The cost — you lose "what did the record look like at the time?" — is real, and is
the only reason to snapshot. Where point-in-time evidence is genuinely required
(regulated manufacturing sign-offs, quality records), that belongs in a **purpose-
built, classified, retention-governed audit table** with its own justification, not
in a debugging log. OWASP's logging cheat sheet makes the same split: keep
sensitive data out of general logs, and where identity must be tracked, use
de-identification — "deletion, scrambling, or pseudonymization."
<https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html>

### 6.4 Hard "never store" items (non-negotiable)

From OWASP logging cheat sheet + PCI DSS Requirement 3.3
(<https://blog.basistheory.com/pci-dss-requirement-3>,
<https://pcidssguide.com/pci-dss-requirement-3/>):

- Sensitive Authentication Data — full magnetic stripe / EMV equivalent, **CVV /
  CVC / CAV2 / CVV2**, PIN and PIN block — must not be stored after authorisation,
  **even encrypted**. This is why `cvv`/`cvc` are in Rails' default filter list.
- PAN must be masked when displayed: at most first 6 and last 4 digits.
- Passwords, access tokens, encryption keys, DB connection strings, session
  identifiers.

### 6.5 Design checklist

- [ ] Denylist is anchored-wildcard, case-insensitive, separator-normalised.
- [ ] Redaction keeps the key, replaces the value with `[REDACTED]`.
- [ ] Recursion into nested objects/arrays with depth + node-count + cycle caps.
- [ ] Outbound HTTP: never store request headers or full response bodies; store
      status, duration, host, and a bounded redacted excerpt.
- [ ] Per-field cap (~250–1024 chars), per-array cap (~50–100 items with
      `… N more items`), per-record byte budget (~1–2 MB).
- [ ] Order: redact → truncate → budget.
- [ ] Entities stored as `{type, id}`, resolved at read time through normal
      authorisation.
- [ ] Three tiers with automated, scheduled downgrade/deletion — not a manual job.
- [ ] Retention windows documented in the privacy notice / RoPA, and enforced by a
      job that is monitored (silent pruning failure = unbounded retention).
- [ ] Per-workflow switch to skip full-detail capture on success (n8n pattern).

---

## Source index

- OWASP Logging Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html>
- OWASP Webhook Security Guidelines (draft) — <https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets_draft/Webhook_Security_Guidelines_Cheat_Sheet.md>
- NIST SP 800-92 — <https://nvlpubs.nist.gov/nistpubs/legacy/sp/nistspecialpublication800-92.pdf>
- NIST SP 800-92r1 (draft) — <https://csrc.nist.gov/pubs/sp/800/92/r1/ipd>
- OMB M-21-31 tiers — <https://www.splunk.com/en_us/blog/learn/m-21-31-cybersecurity.html> · <https://docs.cloud.gov/platform/compliance/m-21-31-compliance/> · <https://aws.amazon.com/blogs/publicsector/aws-federal-customers-memorandum-m-21-31/>
- GDPR Article 5 — <https://gdpr-info.eu/art-5-gdpr/>
- GDPR minimisation/storage commentary — <https://www.legiscope.com/blog/gdpr-data-minimisation-storage-limitation-official.html>
- Pseudonymisation duties — <https://growth-onomics.com/legal-duties-for-pseudonymized-data-under-gdpr/>
- Sentry Python scrubber source — <https://getsentry.github.io/sentry-python/_modules/sentry_sdk/scrubber.html>
- Sentry SDK data-scrubbing spec — <https://develop.sentry.dev/sdk/foundations/data-scrubbing/>
- Sentry server-side scrubbing — <https://docs.sentry.io/security-legal-pii/scrubbing/server-side-scrubbing/>
- Sentry data collected (JS) — <https://docs.sentry.io/platforms/javascript/data-management/data-collected/>
- Sentry options (`maxValueLength`, `maxBreadcrumbs`) — <https://docs.sentry.io/platforms/javascript/configuration/options/>
- Elastic APM sanitization spec — <https://github.com/elastic/apm/blob/main/specs/agents/sanitization.md>
- Elastic APM Node config — <https://www.elastic.co/docs/reference/apm/agents/nodejs/configuration>
- Rails configuring guide — <https://guides.rubyonrails.org/configuring.html>
- Datadog log processing rules — <https://docs.datadoghq.com/logs/guide/commonly-used-log-processing-rules/>
- Datadog Sensitive Data Scanner rules — <https://docs.datadoghq.com/security/sensitive_data_scanner/scanning_rules/>
- Datadog SDS blog — <https://www.datadoghq.com/blog/sensitive-data-scanner/>
- OTel HTTP semconv — <https://opentelemetry.io/docs/specs/semconv/http/http-spans/>
- OTel common spec (attribute limits) — <https://opentelemetry.io/docs/specs/otel/common/>
- Google Cloud DLP infoTypes — <https://cloud.google.com/dlp/docs/infotypes-reference>
- Node.js `util.inspect` — <https://nodejs.org/api/util.html>
- Stripe event retention — <https://support.stripe.com/questions/stripe-event-retention-period>
- GitHub webhook 3-day retention — <https://github.blog/changelog/2023-10-17-webhook-delivery-logs-will-only-be-retained-for-3-days/>
- GitHub viewing webhook deliveries — <https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries>
- GitHub Actions secret masking — <https://docs.github.com/en/actions/reference/security/secure-use>
- Svix payload retention — <https://docs.svix.com/retention>
- Zapier retention — <https://help.zapier.com/hc/en-us/articles/8496327478413-Customize-data-retention-in-Zapier>
- n8n execution data pruning — <https://docs.n8n.io/hosting/scaling/execution-data/>
- Temporal Cloud limits — <https://docs.temporal.io/cloud/limits>
- PCI DSS Req. 3 — <https://blog.basistheory.com/pci-dss-requirement-3> · <https://pcidssguide.com/pci-dss-requirement-3/>
- Webhook security (third-party trust) — <https://www.obsidiansecurity.com/blog/what-is-webhook-security-securing-saas-integrations-2026> · <https://hookdeck.com/webhooks/guides/webhook-security-vulnerabilities-guide>
