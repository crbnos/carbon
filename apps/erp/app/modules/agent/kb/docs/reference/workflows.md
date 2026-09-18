# Workflows

> Build an automation on a canvas: one trigger, conditions, and steps that act, with every firing recorded step by step in run history.

A workflow watches for something happening in Carbon and then does something about it: notify the account manager when a sales order changes hands, open an issue when a job is put on hold, or call your own service when a shipment is posted. You build one on a canvas under **Automate → Workflows**, wire the steps together, and press **"Publish"**. It is a canvas, not a list of rules: steps are cards you drag from the palette and connect by their handles, so one trigger can fan out into several branches that each end differently. Every firing is recorded step by step; see [runs and history](#runs-and-history) below.

## What starts a workflow

Every workflow has exactly one **Trigger** step, and it works one of two ways. The **"Trigger type"** toggle picks between **"Event"** and **"Schedule"**; choosing one clears the other.

**Events.** An event is a specific change to a specific record:

| Shape | Example | What you get |
| --- | --- | --- |
| Created | `job.created` | The new record |
| Deleted | `purchaseOrder.deleted` | The record as it was |
| A column changed | `customer.assignee.changed` | The record, plus its `before` and `after` values |

You pick the exact field you care about. Ten record types can be watched — purchase orders, sales orders, jobs, items, receipts, shipments, quotes, suppliers, customers, and issues — each with its own short list of watched fields. A change to a field nobody watches starts nothing at all.

**Business moments.** Below the per-record events, the picker has one group headed **"Business moments"**: the nine points in Carbon's own flows where something meaningful finished: a job released or put on hold, a job operation completed, a quote sent or accepted, a receipt or shipment posted, a sales or purchase invoice posted. A business moment hands your workflow the *identity* of each record, not a copy of its fields; add a **Find** step when you need to read something the moment didn't name.

**Schedules.** In **"Schedule"** mode you pick a **"Frequency"** of Daily, Weekly, or Monthly, the days it applies to, a **"Time of day"**, and a **"Timezone"**; the builder shows a live **"Next fires at:"** line as you change it.

The time is stored as wall-clock time plus a zone, so 09:00 stays 09:00 across daylight-saving changes. A monthly schedule set to the 31st simply **skips** months with no 31st, and after an outage Carbon resumes from the next due time instead of replaying missed ones. Anything more than an hour late is recorded as skipped. Each workflow also carries a small fixed offset of up to five minutes, so a 9:00 schedule fires somewhere in 9:00–9:05.

**"Triggered by".** Event triggers also choose *who* caused the change: **"People"**, **"Workflows"**, or **"Both"**. A new trigger starts at **"People"**, which is the safe answer: it stops a workflow from reacting to edits made by workflows, including its own. Switch it to **"Both"** deliberately, when you want one automation to feed another.

## The steps you can add

Six kinds, in palette order:

| Step | What it does |
| --- | --- |
| **Trigger** | Starts the workflow. One per workflow, and nothing can connect into it. |
| **Condition** | Sends the run down one path. Each path is a set of clauses, with an optional **"Otherwise"**. |
| **Action** | Does the work — notifies, creates, updates, or calls out. Has separate **Success** and **Failure** handles. |
| **Compute** | Works out a number from a record, such as an order total or a scrap percentage. Read-only. |
| **Find** | Looks a record up so later steps can use it. |
| **Filter** | Keeps only the items in a list that match your rules. |

**Actions** come in three families. Four create records (a job, an issue, a purchase order, or a sales order), each through the same service Carbon's own screens use, so sequences, defaults, and required fields behave identically. Ten update an existing record, one per watched record type. The last two are **"Notify someone"** and **"Call an outside URL"**.

An update step can only set the fields Carbon lists for that record: an assignee, a due date, a reference, a priority. Statuses are not writable from a workflow, and there is no delete action of any kind. What a workflow can *watch* and what it can *write* are two different lists.

## Filling in a step

Most fields take either a value you type or a value from an earlier step. Type `{` in a text field and a menu opens listing the steps above this one, their outputs, and up to two levels of properties. Only steps *guaranteed* to have run before this one are offered — a value from the other side of a condition is not on the menu, and referring to one is rejected at publish.

**Repeating steps.** There is no repeat checkbox. Wire a list into a field that expects a single value and the step runs once per item, which the form confirms in place, up to 100 items. Wiring two lists into the same step is an error at publish time rather than a guess about which one to loop over.

## Calling an outside URL

The **"Call an outside URL"** action sends an HTTP request, a webhook, so another system can react to something in Carbon.

  - **URL**: The `https` address to call. Variables are allowed, so the address can include a record's id.
  - **Method**: `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`. A new step starts at `GET`.
  - **Headers**: Extra information sent with the request, such as an authorization key. Values can contain variables, and every header *value* is masked in run history.
  - **Body**: The request payload, with variables substituted. Only shown and sent for `POST`, `PUT`, and `PATCH`.

Plain `http` is rejected, and so is any address resolving to a private or link-local network, `localhost` and cloud metadata endpoints included. Redirects are not followed, the call gives up after ten seconds, and any answer that isn't a success status fails the step. Eight headers are set by Carbon and cannot be overridden. Carbon does not sign the request — if the receiving system needs to verify the caller, give it a shared secret in a header.

## Saving, publishing, and versions

There is no Save button: the builder saves as you work and reports **"Saving…"**, **"Saved"**, or **"Could not save"** next to the title. A half-finished draft saves happily; nothing is checked until you publish.

**"Publish"** is all-or-nothing. Carbon validates the whole workflow — a trigger exists, no step loops back, every required field is filled, every variable resolves and comes from upstream — and if anything is wrong, nothing is written; the problems appear in a panel and clicking one pans the canvas to the offending step. Publishing is also the only on/off switch: whichever version you publish is the one that runs, and **"Unpublish"** stops the workflow entirely. Nothing is deleted, so publishing again starts it back up. A workflow with nothing published reads as **Draft**.

Publishing freezes that version. To keep working, use the version menu to create a new version, which copies the published one and numbers it one higher. A run already in flight keeps using the version it started with even if you publish another mid-run. The trigger card also has a **"Test run"** button (owner only): it executes for real, but the result is never written to run history.

## Who can do what

Workflows have their own permission module: **View** opens the list, builder, and run history; **Create** adds workflows and versions; **Update** edits, publishes, and test-runs; **Delete** removes a workflow with its versions and history. Every route also requires an employee account.

Every step reads and writes with the owner's permissions, re-checked at each step. If the owner's access is revoked the run stops with a plain message naming the area. Nothing a workflow does can reach outside the company it belongs to — and run history is read-only in the database itself, so no user, however privileged, can edit or forge a run log.

## Runs and history

Every firing is recorded as a workflow run: one row for the run and one per step, with the values in, the values out, and why it ended the way it did. Open **Automate → Runs** for the list: status, workflow, trigger, the record it started from, duration, owner, and a **Chain** cell reading **"Hop 2"** when the run was caused by another run. Rows update live while anything is queued or running.

  - **Queued**: Accepted and waiting for a worker to pick it up.
  - **Running**: A worker has claimed it and is walking the steps.
  - **Succeeded**: Every step that ran finished without error.
  - **Failed**: At least one step failed, or the run hit the 500-step ceiling.
  - **Blocked**: A loop guard stopped it before any step ran. The reason is on the run.
  - **Skipped**: It never started: the workflow was unpublished, or a scheduled run came due too late, or its previous run was still going.

Clicking a row opens the **"Run Details"** drawer with a one-line plain-English outcome (*"Failed at 'notify the buyer': The address answered 500."*). Below it the steps appear in workflow order rather than execution order, so a step that never ran still holds its place, greyed and marked **"Not reached"** or skipped with its reason. Expand a step for its **Input**, **Output**, and — on conditions — a clause-by-clause **Why** with the path taken marked. A repeating step records each item plus a summary that counts what actually ran (*"Ran 100 of 150; 50 were not used"* means the 100-item cap, not an error).

If a condition matches none of its paths and has no **"Otherwise"**, that step *succeeded* — it correctly decided not to continue. The run ends successful with most steps never reached, which is why the outcome sentence spells out what happened instead of leaving you to read a green badge. Missing data is likewise a skip, not a failure, and a condition whose values cannot be read does **not** fall through to its **"Otherwise"**: an unknown is not a no.

A failed step stops its branch, not the run: other branches keep going, and a wired **Failure** handle is followed, though the run is marked failed at the end regardless. The one exception is a permission failure, which stops the branch outright even when a failure path exists.

**Chains.** When a workflow's writes trigger another workflow, the runs are linked and the drawer draws the whole chain. Two guards record a **Blocked** run rather than looping forever: a cycle (the same workflow already ran in this chain) and a depth limit of ten hops. The [**"Triggered by"**](#what-starts-a-workflow) setting is the first line of defence.

A finished run cannot be re-run from the Runs page. Fix the outside cause and let the next trigger fire, or use the builder's **"Test run"**. A run that crashes mid-flight is retried automatically by the queue, and because each step is claimed before it acts, the retry cannot repeat work that already completed.

**Retention.** A nightly job tidies history in four passes, ignoring runs still in flight: after 24 hours a run still queued or running is closed as failed; after 7 days recorded values are summarised in place; after 30 days step rows are deleted (the run survives); after 90 days the run is deleted entirely. Values whose names look like credentials are stored as `[REDACTED]` and every webhook header value is masked, while ordinary fields that merely sound sensitive (an item key, who authorised something) are left alone: a debugging tool that hides too much is as broken as one that hides too little.

## Related

  - Notifications Where a workflow's "Notify someone" step lands, and how people mute topics.
  - Approvals Rule-based gates on documents, the other half of Automation.
  - Audit log The separate, entity-centric record of who changed what.

## Internals, exact messages, and troubleshooting

Builder: the variable menu placeholder is "Type &#123; to insert a variable"; cross-branch references are rejected at publish with "This uses a value from a step that does not always run before it."; a list wired into a single-value field confirms "A list is wired into … so this step runs once for each item in it — up to 100." The Compute step was previously named "Record" — old workflows open as Compute and keep their step names. Webhook: blocked headers fail publish with "… is set by Carbon and cannot be changed here."; Content-Type defaults to application/json on body-carrying methods; the response status is the step's output and the first part of the body is kept in the step summary. Publish problems appear in a panel headed like "3 problems — not published". The published-version lock reads "This version is published. Create a new version to edit." Test run notes "The result will not appear on the Runs page."

Runs: step statuses are Running / Succeeded / Failed / Skipped only (Queued and Blocked are run-level). Outcome sentence examples: "Completed — 4 of 6 steps ran."; "Nothing happened — 'only if overdue' matched none of its conditions, so the 3 steps after it never ran."; "Stopped early — 'find the customer' was skipped: That list was empty, so there was nothing to do."; "Blocked — Cycle: this workflow already ran in this chain". Skip labels: "Not reached", "Skipped — the check above didn't match", "Skipped — an earlier step failed". Repeating summaries: "Ran 3 of 3; 1 failed." — the summary succeeds if at least one item succeeded; an empty list is one skipped step ("That list was empty, so there was nothing to do."). Blocked reasons: "Cycle: this workflow already ran in this chain" and "Chain depth limit reached (10 hops)". A "Show raw" toggle dumps the underlying JSON. Scheduled runs have a blank Record cell.

Retention banners: the 24-hour reaper writes "This run stopped reporting and was closed automatically after 24 hours."; after summarising the drawer shows "Values in this run have been summarised. Full detail is kept for 7 days."; after step deletion, "Step detail is kept for 30 days. This run's steps have been removed." Redacted key patterns include secret, token, password, authorization, api key, bearer, cookie; deliberately NOT redacted: itemKey, authorizedBy, keyword, sessionId. Owner-permission failures read like "The owner of this workflow no longer has access to Purchasing."

### A run is missing from the Runs page
Test runs are never written to history. Scheduled runs more than an hour late are recorded as Skipped, not missing. Runs older than 90 days are deleted by retention.

### Why did my workflow fire twice / react to itself?
"Triggered by" is set to "Both" (or "Workflows"). Set it to "People" to ignore workflow-caused edits, including its own.

### The run shows Succeeded but nothing happened
A condition matched no path and had no Otherwise — that is a successful decision not to continue. Read the outcome sentence; it names the condition.

### Steps are gone from an old run
Retention: step rows are deleted after 30 days, the run header after 90. The drawer's banner distinguishes "steps purged" from "run has no steps yet".
