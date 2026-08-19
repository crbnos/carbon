# Workflows

> Build an automation on a canvas — one trigger, conditions, and steps that notify people, update records, or call an outside service. Triggers, values, publishing, and versions.

A workflow watches for something happening in Carbon and then does something about it: notify the account manager when a sales order changes hands, open an issue when a job is put on hold, or call your own service when a shipment is posted. You build one on a canvas under **Automate → Workflows**, wire the steps together, and press **"Publish"**.

It is a canvas, not a list of rules. Steps are cards you drag from the palette and connect by their handles, so one trigger can fan out into several branches that each end differently. Runs are recorded step by step — see `docs/reference/workflow-runs`.

## What starts a workflow

Every workflow has exactly one **Trigger** step, and it works one of two ways. The **"Trigger type"** toggle picks between **"Event"** and **"Schedule"**; choosing one clears the other.

**Events.** An event is a specific change to a specific record. Names follow the record and what happened to it:

| Shape | Example | What you get |
| --- | --- | --- |
| Created | `job.created` | The new record |
| Deleted | `purchaseOrder.deleted` | The record as it was |
| A column changed | `customer.assignee.changed` | The record, plus its `before` and `after` values |

You pick the exact field you care about. Ten record types can be watched — purchase orders, sales orders, jobs, items, receipts, shipments, quotes, suppliers, customers, and issues — each with its own short list of watched fields. A change to a field nobody watches starts nothing at all.

**Business moments.** Below the per-record events, the picker has one group headed **"Business moments"**. These are the nine points in Carbon's own flows where something meaningful finished, rather than a raw column edit:

| Moment | Reads |
| --- | --- |
| A job is released | The job, and who released it |
| A job is put on hold | The job, and who held it |
| A job operation is completed | The job, the operation, and who completed it |
| A quote is sent | The quote, and who sent it |
| A quote is accepted | The quote and the sales order it became |
| A receipt is posted | The receipt, and who posted it |
| A shipment is posted | The shipment, and who posted it |
| A sales invoice is posted | The invoice, and who posted it |
| A purchase invoice is posted | The invoice, and who posted it |

A business moment hands your workflow the *identity* of each record, not a copy of its fields. Add a **Find** step when you need to read something the moment didn't name.

**Schedules.** In **"Schedule"** mode you pick a **"Frequency"** of Daily, Weekly, or Monthly, the days it applies to, a **"Time of day"**, and a **"Timezone"**. The builder shows a live **"Next fires at:"** line as you change it. Minutes are chosen in five-minute steps, and Monthly offers **"Last day"** alongside the numbered days.

The time is stored as wall-clock time plus a zone, so 09:00 stays 09:00 across daylight-saving changes. Two consequences worth knowing: a monthly schedule set to the 31st simply **skips** months that have no 31st rather than sliding to the end of the month, and after an outage Carbon resumes from the next due time instead of replaying missed ones. Anything more than an hour late is recorded as skipped rather than run late. Each workflow also carries a small fixed offset of up to five minutes, so a 9:00 schedule fires somewhere in 9:00–9:05.

**"Triggered by".** Event triggers also choose *who* caused the change: **"People"**, **"Workflows"**, or **"Both"**. A new trigger starts at **"People"**, which is the safe answer — it stops a workflow from reacting to edits made by workflows, including its own. Switch it to **"Both"** deliberately, when you want one automation to feed another.

## The steps you can add

Six kinds, in palette order.

| Step | What it does |
| --- | --- |
| **Trigger** | Starts the workflow. One per workflow, and nothing can connect into it. |
| **Condition** | Sends the run down one path. Each path is a set of clauses, with an optional **"Otherwise"**. |
| **Action** | Does the work — notifies, creates, updates, or calls out. Has separate **Success** and **Failure** handles. |
| **Compute** | Works out a number from a record, such as an order total or a scrap percentage. |
| **Find** | Looks a record up so later steps can use it. |
| **Filter** | Keeps only the items in a list that match your rules. |

A **Compute** step is read-only. Its picker is titled **"Operation"**, and it works out a value such as a purchase order's total, a sales order's line count, a job's scrap percentage or earliest operation start, or an item's quantity on hand. Everything that *writes* is an **Action** step.

Workflows you built before the rename are unaffected — they open as **Compute** steps and keep whatever step names you gave them.

**Actions** come in three families. Four create records — a job, an issue, a purchase order, or a sales order — and each runs through the same service Carbon's own screens use, so sequences, defaults, and required fields behave identically. Ten update an existing record, one per watched record type. The last two are **"Notify someone"** and **"Call an outside URL"**.

An update step can only set the fields Carbon lists for that record — an assignee, a due date, a reference, a priority. Statuses are not writable from a workflow, and there is no delete action of any kind. What a workflow can *watch* and what it can *write* are two different lists.

**Find** works over any record type, with **"How many"** set to **"Just one"** or **"Every match"** and a set of **"Match"** rules. **Filter** narrows a list you already have: pick a **"Source list"**, then add rules.

## Filling in a step

Most fields take either a value you type or a value from an earlier step. Type `{` in a text field — the placeholder says **"Type &#123; to insert a variable"** — and a menu opens listing the steps above this one, then their outputs, then up to two levels of properties. Fields that aren't free text show a picker instead, and the same menu anchors to it.

Only steps that are *guaranteed* to have run before this one are offered. A value from the other side of a condition is not on the menu, and referring to one is rejected when you publish: *"This uses a value from a step that does not always run before it."*

**Repeating steps.** There is no repeat checkbox. Wire a list into a field that expects a single value and the step runs once per item, which the form confirms in place: *"A list is wired into … so this step runs once for each item in it — up to 100."* Wiring two lists into the same step is an error at publish time rather than a guess about which one to loop over.

## Calling an outside URL

The **"Call an outside URL"** action sends an HTTP request — a webhook — so another system can react to something in Carbon.

  - **URL**: The `https` address to call. Variables are allowed, so the address can include a record's id.
  - **Method**: `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`. A new step starts at `GET`.
  - **Headers**: Extra information sent with the request, such as an authorization key. Use **"Add header"** to add a row; values can contain variables.
  - **Body**: The request payload, with variables substituted. Only shown for `POST`, `PUT`, and `PATCH`, and only sent on those.

Carbon sends `Content-Type: application/json` on the methods that carry a body, unless you set a content type of your own. The response status comes back as the step's output, and the first part of the response body is kept in the step summary so you can see what the other end said.

Plain `http` is rejected, and so is any address that resolves to a private or link-local network — that includes `localhost` and cloud metadata endpoints. Redirects are not followed, because following one would land somewhere that never passed those checks. The call gives up after ten seconds, and any answer that isn't a success status fails the step. Eight headers are set by Carbon and cannot be overridden, among them `Host`, `Content-Length`, and `Connection`; setting one blocks publishing with *"… is set by Carbon and cannot be changed here."*

Every header *value* is masked in the run log while the names stay readable, so an API key you paste into a header is not sitting in your own audit trail. Carbon does not sign the request — if the receiving system needs to verify the caller, give it a shared secret in a header.

## Saving, publishing, and versions

There is no Save button. The builder saves as you work and reports its state next to the title as **"Saving…"**, **"Saved"**, or **"Could not save"**. A half-finished draft saves happily; nothing is checked until you publish.

**"Publish"** is all-or-nothing. Carbon validates the whole workflow — a trigger exists, no step loops back, every step is reachable, every required field is filled, every variable resolves and comes from upstream, every type lines up — and if anything is wrong, **nothing is written**. The problems appear in a panel headed **"3 problems — not published"**, and clicking one pans the canvas to the step it belongs to.

Publishing promotes a version to live **and** turns the workflow on. The **"Active"** switch, on the list and in the builder, is a separate kill switch: turning it off removes the workflow's trigger registrations so nothing fires, while leaving the published version in place. A workflow only runs when it is active *and* has a live version.

Publishing also freezes that version. The builder locks with *"This version is live. Create a new version to edit."* — to keep working, use the version menu to create a new version, which copies the live one and numbers it one higher. Older versions stay readable, and a run that is already in flight keeps using the version it started with even if you promote another one mid-run.

**Test run.** The trigger card has a **"Test run"** button, available to the workflow's owner. It executes for real, so anything it creates or sends actually happens, but the result is never written to run history: *"The result will not appear on the Runs page."*

## Who can do what

Workflows have their own permission module, seeded from your existing settings access, and every route also requires an employee account.

| You need | To |
| --- | --- |
| View | Open the list, the builder, and run history |
| Create | Add a workflow, or create a new version of one |
| Update | Edit, publish, rename, toggle active, test run |
| Delete | Delete a workflow, its versions, and its run history |

Every step reads and writes with the owner's permissions, re-checked at each step rather than cached, and Carbon confirms the owner still has access to the relevant area before running. If the owner's access is revoked the run stops with a plain message naming the area, such as *"The owner of this workflow no longer has access to Purchasing."* Nothing a workflow does can reach outside the company it belongs to.

Run history is read-only in the database itself — the engine writes it privately, and no user, however privileged, can edit or forge a run log.

  - Workflow runs What happened on each run, why a step was skipped, and how long history is kept.
  - Notifications Where a workflow's "Notify someone" step lands, and how people mute topics.
  - Permissions and access How employee types map to module permissions.
