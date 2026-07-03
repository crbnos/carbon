---
name: test
description: Agentically test a specific feature end-to-end in the running Carbon dev server — analyze the branch diff (or a given feature/issue), build a test plan, drive the app with agent-browser, and cache successful playbooks to .ai/playbooks/ for reuse. Use to verify a feature or fix actually works in the browser ("test this", "verify in the browser", after /execute or /fix for user-facing changes). Builds on /auth and /error. For a broad does-everything-load sweep use /smoke-test.
---

# test — feature test through the real browser

Drive the running app through the changed flows like a user would, verify
results, and cache what worked as a playbook. A user-facing change that hasn't
passed this (or an equivalent unit-test proof) is not done.

**Announce at start:** "Using the test skill — browser-testing {feature/flows}."

## Arguments

- Feature description: `/test creating a purchase order`
- GitHub issue: `/test #1234`
- Nothing: infer targets from the branch diff

## Step 1: Check for a cached playbook FIRST

```bash
ls .ai/playbooks/
```

If a playbook matches the feature (e.g. `create-purchase-order.md`), read it and
use its steps, selector notes, and field values directly — skip to Step 4. Only
build a plan from scratch when no playbook fits.

## Step 2: Decide what to test

- Feature given → that's the target.
- Issue given → `gh issue view <number> --json title,body`.
- Nothing given → read the diff:

```bash
git diff $(git merge-base origin/main HEAD) --stat
git log --oneline $(git merge-base origin/main HEAD)..HEAD
```

Testable signals: new/changed routes under `routes/x+/` (user-facing pages),
service changes under `modules/` (business logic), new migrations (schema →
forms). Pick 1–3 concrete user workflows ("create a purchase order", "update a
job's details").

## Step 3: Write the test plan

For each workflow, list the steps a user performs: **navigate → fill → submit →
verify** (redirect, toast, record in list). Print the plan before executing so
the user sees what you intend to do.

## Step 4: Login

Invoke `/auth`. If it fails, STOP and report.

## Step 5: Execute each test

Read `ERP_URL` from `.env.local`, then per workflow:

### 5a. Navigate

```bash
agent-browser open ${ERP_URL}/<route> && agent-browser wait --load networkidle && agent-browser snapshot -i
```

### 5b. Interact — Carbon form rules (these are load-bearing)

**Text inputs:**

```bash
agent-browser fill @eN "value"
```

**Combobox/select fields** (Carbon uses custom comboboxes):

```bash
agent-browser click @eN     # open the dropdown
agent-browser snapshot -i   # find option refs
agent-browser click @eM     # pick the option — this updates React state reliably
```

**Number / currency / date fields (react-aria) — fill, then BLUR.** These render
a visible formatted input plus a hidden input that carries the form value; the
hidden input commits **on blur**, not per keystroke:

```bash
agent-browser fill @eN "300"   # visible field
agent-browser click @eM        # click any other field to blur → commits the hidden input
agent-browser eval "document.querySelector('input[name=amount]').value"   # verify => "300"
```

`agent-browser type` often does NOT reach these fields — always `fill` + blur.

**Submit — `requestSubmit`, never a click.** Carbon forms are `@carbon/form`
`ValidatedForm`; the submit handler only runs on a native `submit` event carrying
a `submitter` — a plain click on Save does nothing (silently):

```bash
agent-browser eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.type==='submit'&&x.textContent.trim()==='Save');const f=b.closest('form');f.requestSubmit(b);return 'submitted'})()"
agent-browser wait --load networkidle
agent-browser snapshot -i
```

Adjust the button text (`Save`/`Create`/`Submit`) to the form. For **drawer
forms** (child routes as overlays), `requestSubmit` the drawer's own form, not
the parent page's.

> A submit that "does nothing" is almost always: (a) you clicked instead of
> `requestSubmit`-ing, or (b) a react-aria field's hidden input never committed
> (you didn't blur). Verify hidden inputs before blaming the form.

### 5c. Verify the result

Success: redirect to a detail page / URL change, success toast, record visible
in the list. Failure: validation errors, error toast, "Something went wrong", no
change. On failure → invoke `/error` to capture diagnostics, then continue with
the remaining tests.

### 5d. Record

**PASS** (submitted, expected result verified) · **FAIL** (error/unexpected) ·
**SKIP** (prerequisite missing — e.g. no suppliers seeded; say what's missing).

## Step 6: Cache the playbook (after every PASS)

Write/update `.ai/playbooks/<feature-slug>.md` (kebab-case). This is what makes
future runs fast — do not skip it.

```markdown
# <Feature Name>

Last tested: <YYYY-MM-DD>
Route: /x/<route>

## Prerequisites
- <required data, e.g. "at least one supplier exists">

## Steps
### 1. Navigate — URL, expected form fields
### 2. Fill — Field "<label>" (<hint: "first combobox">): "<value>"
### 3. Submit — requestSubmit the form whose button reads "<label>" (NOT a click)
### 4. Verify — expected redirect/toast

## Selector Notes
- <how to find tricky fields: by label, position, role>

## Common Failures
- <validation errors hit on the way to PASS and their causes>
```

Rules: describe selectors by label/position/role, never cached refs like `@e5`
(they change per session); only cache PASSes; update existing playbooks instead
of duplicating; record prerequisite-data observations.

## Step 7: Report, then cleanup

| # | Test | Status | Notes |
|---|------|--------|-------|
| 1 | Create purchase order | PASS | PO-000123 created, redirected to detail |
| 2 | Create job | FAIL | "Location is required" — capture: .ai/scratch/e2e/… |

Include `/error` capture paths for failures. Then `agent-browser close`.

## Failure handling

- Page won't load → `/error`, move on.
- Field not findable → snapshot, note it, move on.
- Missing prerequisite data → SKIP with explanation.
- Never abort the whole run for one failure — finish all planned tests.
