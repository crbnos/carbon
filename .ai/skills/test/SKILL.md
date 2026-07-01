---
name: test
description: Agentically test a specific feature by analyzing the branch diff, building a test plan, and driving the app through agent-browser. Builds on /login and /error skills. Caches successful playbooks to .ai/playbooks/ for reuse.
---

# Feature Test

Agentically test a specific feature or workflow in the running Carbon ERP dev server. Analyzes the current branch to understand what changed, then drives the browser through the relevant create/update/delete flows to verify they work end-to-end.

## Arguments

The user may provide:
- A feature description: `/test creating a purchase order`
- A GitHub issue: `/test #1234`
- Nothing (infer from the branch diff): `/test`

## Procedure

### Step 1: Check for existing playbooks

Before doing anything else, check if there are cached playbooks for the feature being tested:

```bash
ls .ai/playbooks/
```

If a matching playbook exists (e.g., `create-purchase-order.md` when testing purchase order creation), read it and use the cached navigation steps, selectors, and field mappings. This saves significant time — skip to Step 4 (Login) and use the playbook's steps directly.

If no playbook exists, continue to Step 2 to build one from scratch.

### Step 2: Understand what to test

**If a feature description was provided**, use it directly as the test target.

**If a GitHub issue was provided**, fetch it:
```bash
gh issue view <number> --json title,body
```

**If nothing was provided**, analyze the branch diff to identify testable features:
```bash
git diff main --stat
git log --oneline main..HEAD
```

Focus on:
- New or modified route files under `routes/x+/` (these are user-facing pages)
- Changes to service files under `modules/` (business logic changes)
- New migrations (schema changes that affect forms)

From this analysis, identify 1-3 concrete user workflows to test (e.g., "create a new purchase order", "update a job's details", "create a stock transfer").

### Step 3: Build the test plan

For each workflow, plan the steps as a user would perform them:

1. **Navigate** to the relevant page (list view or "new" form)
2. **Fill** required form fields with realistic test data
3. **Submit** the form
4. **Verify** the result (redirect to detail page, success toast, record appears in list)

Write the plan out before executing so the user can see what you intend to do.

### Step 4: Login

Invoke the `/login` skill to authenticate the browser session. If login fails, stop and report.

### Step 5: Read ERP_URL

```bash
grep ERP_URL .env.local
```

### Step 6: Execute each test

For each planned workflow:

#### 6a. Navigate to the page

```bash
agent-browser open ${ERP_URL}/<route> && agent-browser wait --load networkidle && agent-browser snapshot -i
```

#### 6b. Interact with the form

Use snapshot refs to fill fields and click buttons. General patterns:

**Text inputs:**
```bash
agent-browser fill @eN "value"
```

**Select/combobox fields (Carbon uses custom comboboxes):**
```bash
agent-browser click @eN          # open the dropdown
agent-browser snapshot -i        # find the option refs
agent-browser click @eM          # select the option
```
Clicking an option updates the field's React state correctly (it persists across
re-renders), so comboboxes are reliable.

**Number / currency / date fields (react-aria — IMPORTANT):**
These render a *visible* formatted input plus a *hidden* input that actually carries
the form value (e.g. `<input type=hidden name="amount">`). react-aria only commits
the hidden input **on blur**, not on each keystroke. So you MUST fill, then blur:
```bash
agent-browser fill @eN "300"     # the visible field
agent-browser click @eM          # click ANY other field to blur → commits hidden input
# verify it committed:
agent-browser eval "document.querySelector('input[name=amount]').value"   # => "300"
```
`agent-browser type` often does NOT reach these fields — use `fill` + blur.

**Submit (CRITICAL — do NOT click the submit button):**
Carbon forms are `@carbon/form` `ValidatedForm` (vendored remix-validated-form). Its
submit handler only runs on a **native `submit` event that carries a `submitter`**
(`if (submitter?.form !== target) return;` — it bails silently otherwise). An
agent-browser `click` on the Save button does **not** trigger that native submit, so
nothing happens (no error, no navigation). Submit programmatically instead, passing
the button as the submitter:
```bash
agent-browser eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.type==='submit'&&x.textContent.trim()==='Save');const f=b.closest('form');f.requestSubmit(b);return 'submitted'})()"
agent-browser wait --load networkidle
agent-browser snapshot -i        # verify the result (redirect / toast)
```
Adjust the button text (`'Save'`/`'Create'`/`'Submit'`) to match the form. The
handler validates `new FormData(form)` (the real DOM) synchronously, so as long as
every field's value/hidden-input is set (see number-field note above), this submits
exactly as a real user click would — exercising the real client validation + action.

> If a submit "does nothing", it's almost always one of: (a) you clicked the button
> instead of `requestSubmit`-ing, or (b) a react-aria number/date field's hidden input
> never committed (you didn't blur it). Verify the hidden inputs before blaming the form.

#### 6c. Verify the result

After submission, check the snapshot for:
- **Success indicators**: redirect to a detail page, URL changed, "created" or "updated" text, success toast
- **Failure indicators**: validation errors (red text, "is required"), error toasts, "Something went wrong", page didn't change

If verification shows an error, invoke the `/error` skill to capture diagnostics, then continue to the next test.

#### 6d. Record the result

Track each test with its status:
- **PASS**: Form submitted, redirected to expected page, record created/updated
- **FAIL**: Error encountered, validation failed, unexpected behavior
- **SKIP**: Could not test (prerequisite missing, page not found)

### Step 7: Cache successful playbooks

After each **PASS** test, write or update a playbook file at `.ai/playbooks/<feature-slug>.md`. This is critical for future efficiency.

**Playbook format:**

```markdown
# <Feature Name>

Last tested: <date>
Route: <URL path>

## Prerequisites
- <any required data, e.g., "at least one supplier must exist">

## Steps

### 1. Navigate
- URL: `/x/<route>/new`
- Expected: form with fields [list fields seen]

### 2. Fill form
- Field "<label>" (<selector hint, e.g., "first combobox">): "<value>"
- Field "<label>" (<selector hint>): "<value>"
- ...

### 3. Submit
- `requestSubmit` the form whose submit button reads "<button label>" (NOT a click)

### 4. Verify
- Expected redirect: `/x/<route>/<id>`
- Success indicator: <what to look for>

## Selector Notes
- The supplier combobox is the first combobox on the page, labeled "Supplier"
- The location field auto-populates from user defaults
- The submit button is labeled "Save" in the form footer
- After submit, a toast appears briefly with "Purchase order created"

## Common Failures
- "Supplier is required" — no suppliers seeded in the database
- "Location is required" — user has no default location assigned
```

**Rules for playbook caching:**
- Use kebab-case filenames: `create-purchase-order.md`, `create-job.md`, `update-quote.md`
- Only cache after a PASS — never cache failed or partial runs
- Include selector hints (not exact refs like `@e5`, since those change between sessions), describe them by label, position, or role (e.g., "the first combobox labeled Supplier")
- Record common failures you encountered before getting to PASS — this helps future runs avoid dead ends
- Update existing playbooks rather than creating duplicates
- Include prerequisite data observations (e.g., "needs at least one supplier")

### Step 8: Report

Print a summary table:

| # | Test | Status | Notes |
|---|------|--------|-------|
| 1 | Create purchase order | PASS | Created PO-000123, redirected to detail page |
| 2 | Create job for part | FAIL | "Location is required" validation error |
| 3 | Update quote details | PASS | Updated customer name successfully |

If any tests failed, include the screenshot paths from `/error`.

### Step 9: Cleanup

```bash
agent-browser close
```

## Tips for Carbon ERP forms

- **Required fields** are marked with asterisks or show validation errors on submit
- **Combobox/select fields** need a click to open, then a search or click on an option
- **Number / currency / date fields** are react-aria: `fill` the visible input then
  **blur** (click another field) so the hidden `name=...` input commits. `type` often
  doesn't reach them. Verify with `eval "document.querySelector('input[name=X]').value"`.
- **Submit with `requestSubmit`, never a click** — see step 6b. A plain agent-browser
  click on the Save button does NOT fire the native submit that `ValidatedForm`
  requires, so the form silently does nothing.
- **After creating a record**, the app typically redirects to the detail page with the new record's ID in the URL
- **Drawer forms** (child routes) appear as overlays — `requestSubmit` the drawer's own form (the one containing the drawer's submit button), not the parent page's
- **Toast notifications** appear briefly — check the snapshot immediately after submission

## Failure Handling

- If a page fails to load, invoke `/error` and move to the next test
- If a form field can't be found, take a snapshot, log the issue, and move on
- If prerequisite data is missing (e.g., no suppliers exist to create a PO), note it as SKIP with an explanation
- Never stop the entire test run for a single failure — complete all planned tests
