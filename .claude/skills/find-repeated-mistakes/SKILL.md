---
name: find-repeated-mistakes
description: Mine the git history for a mistake the repo keeps fixing, prove it is one root cause with three or more independent fixes, and turn it into the strongest guard that stops the next one — architecture, a type, a conformance check that names the past fix, or a database test — proven on the real past bug and baselined only for existing sites. Use when asked to "find repeated mistakes", "what keeps breaking", "turn these fixes into a check", after a second fix of the same kind, or when a class of bug (races, retries, status changes, unchecked errors, tenant scoping) keeps coming back. Do not use to fix one bug — use /fix — or for a general code audit — use /improve.
---

# find-repeated-mistakes — make a mistake the repo keeps fixing impossible to ship again

Input: a time window (default 6 months) and a cause family (default: races,
retries and status changes). Output: a findings record at
`.ai/runs/{YYYY-MM-DD}-repeated-mistakes-{slug}.md` and, for each confirmed
root cause, one guard, proven to fail on the code from before a real fix and
to pass on the fix.

**Announce at start:** "Using the find-repeated-mistakes skill — {cause family}, last {N} months."

## Step 1: List the candidate fixes

Skip the `git fetch` when `origin/main` was fetched in this session.

```bash
git fetch origin main
git log origin/main --no-merges --since="6 months ago" --abbrev=10 --format='%h %cs %s' -i -E \
  --grep='twice|double[ds]?|second (void|post|click|tab|request|run|time)|race|concurren|in parallel|retr(y|ied|ies)|replay|lost update|overwr|idempoten' \
  | grep -iE '^[0-9a-f]{10} [0-9-]{10} fix'
```

`--grep` reads the subject AND the body; the `grep` keeps fix commits only.
Expect one line per commit, `<sha> <date> fix(<scope>): <subject>`: 137 lines
for 6 months of this repo on 2026-11-24 with the default pattern, about 80 for
3 months. The real race fixes are in it (`2c9ef0dd8f` quote replay,
`bbe8dfd6a9` receipt post, `ca513209d8` double material issue). For another
cause family, put the part of its line below before the `#`, trimmed, in
place of the `--grep='…'` pattern (counts are for 3 months on 2026-11-24):

```text
unchecked|ignored (the )?error|error (was )?(ignored|dropped|swallowed)|silently|never (checked|read) (the|its) (error|result)    # unchecked or swallowed errors, ~26
companyId|cross-tenant|another company|other compan                                  # tenant scoping, ~41
time ?zone|UTC|local (date|time)|off by (one|a) day                                  # dates and time zones, ~10
round(ing|ed)|precision|toFixed|cents?                                               # rounding and precision, ~33
```

The keyword match is broad on purpose. Expect to drop most candidates in
Step 2: a third or fewer are real fixes of the family.

| Output | Action |
|---|---|
| 0 lines | Check `git log origin/main -1` prints a commit; widen to 12 months. Still 0 → STOP, report "no candidates". |
| More than 150 lines | Narrow the window to 3 months. |

## Step 2: Read every candidate; keep only a clear root cause

Read every line of the Step 1 output, one `git show` per sha (one command per
call; a shell loop over shas may be refused by the sandbox):

```bash
git show --stat --format='%h %s%n%n%b' <sha>
git show <sha> -- <path>
```

`<path>` is the file the message describes. When the message names none, take
the non-test file with the most changed lines in the `--stat`. The function is
the name after the second `@@` of the hunk that holds the fix
(`@@ -11069,13 +11069,16 @@ export async function postSalesInvoice(`).

| The commit… | Keep? |
|---|---|
| Names the cause and the diff removes it (the UPDATE gains `.eq("status", …)`, the read moves under the lock) | Keep. Write one line: `<sha> <file>:<function> — <cause in one sentence>` |
| Lists several fixes (bullets, many files) | Keep each bullet whose cause you can tie to one hunk, as its own line. Drop the rest |
| Matched a keyword in another sense (`import { unchecked }`, a dialog "mounts twice", a filter "works again") | Drop — not this cause family |
| Is a follow-up, review fix or test-only change of an earlier kept commit | Drop; it is not an independent fix |
| Cause unclear after reading the diff | Drop. Do not guess a cause |

## Step 3: Group by root cause; require 3 independent fixes

Group the kept lines by the sentence that names the cause (for example "the
status was checked in code and the UPDATE matched on id alone"). A group is
**confirmed** when it has 3 or more fixes in different functions or different
incidents, or 2 fixes plus a live instance on `origin/main` today. Find a live
instance with the shape the fixes removed:

```bash
git grep -n -A1 -E '\.selectFrom\("salesInvoice"\)' origin/main -- 'apps/erp/app/modules/**/*.service.ts' | grep -E 'select\("id"\)'
```

This example looks for the invoice void race: a lock whose select reads only
`id`. Each output line, `origin/main:<file>-<line>-  .select("id")`, is a live
instance; read it to confirm. No output means none: the invoice voids were
fixed on main in b6ca51d4e1, so this example prints nothing today. Replace the
table and the second pattern with the shape your group's fixes removed.

| Group | Action |
|---|---|
| 3+ independent fixes, or 2 + a confirmed live instance | Confirmed: Step 4 |
| Fewer | Record it under "Not confirmed" in the output. No guard |

## Step 4: Is there a guard already, and does it have a hole?

Search with the API, column or call the fixes changed (`forUpdate`,
`quantityIssued`, `companyId`, `.error`), not with the cause's name:

```bash
grep -n -i '<api, column or call>' packages/checks/src/conformance/*.ts
grep -n '^  id: \|_ID = \|^export const [A-Z_]* = "' packages/checks/src/conformance/*.ts
grep -n -i '<api, column or call>' .oxlintrc.json
```

The subject files under `packages/checks/src/conformance/` hold every
conformance check, with its rule in the comment above it; `.oxlintrc.json` holds
the lint rules. Read each match and decide
whether it fails the code from before your group's fixes. When a guard exists,
date it and look for fixes of the same cause after that date:

```bash
git log --reverse -S'"<id>"' --format='%h %cs' -- packages/checks/src | head -1
```

Expect one line, `<sha> <YYYY-MM-DD>`. Re-run the Step 1 command with
`--since=<that date>`.

| Finding | Action |
|---|---|
| No guard | Step 5 |
| A guard, and no fix of this cause after its date | Covered. Record it; no new guard |
| A guard, and fixes continued after it | A hole. Step 5 closes the hole in that guard; read the fix that got through to see which form it missed (`status-write-guarded` passed any lock until 578c411ffe showed a lock that never read the status) |

## Step 5: Choose the strongest enforcement

Take the FIRST row that can express the rule. Do not skip down for less work.

| Order | Enforcement | Use when |
|---|---|---|
| 1 | Architecture: make the mistake unwritable (one helper is the only way to write the row; the unsafe API is not exported) | The mistake happens through a call site you can remove |
| 2 | Types: the compiler refuses it (a branded type, a required argument) | The mistake is a wrong value or a missing argument |
| 3 | A conformance check in `packages/checks` whose error message names the fix to make | The mistake has a text shape a scan can find |
| 4 | A database test | Only Postgres shows it: locking, triggers, RLS, ordering |

For races, retries and status changes the fix is always one of: a guarded
UPDATE (`.eq("status", <from>)`, refuse when no row changed), a row lock taken
BEFORE the read (`.select("status")…forUpdate()`, then re-check), a relative
write (`` sql`"quantityIssued" + ${delta}` ``), or an idempotency key on a
retried external create (`.claude/rules/concurrency.md`). Add a database test
with TWO connections that holds the lock on one and runs the second writer
(`apps/erp/test/database/period-close-concurrency.test.ts`: `f.connect()`
twice). One connection serializes the two writers and passes on the bug. Then
register the fixed function in `packages/checks/guarded-code.json` with that
test, so a later change to it warns in CI.

STOP and ask before you change an existing check's rule (it may fail CI for
other branches) or the database schema of a production table.

## Step 6: Prove the guard on the real past bug

A check that never failed on the real bug proves only that it parses its own
fixtures. In the test file of the check's subject,
`packages/checks/src/conformance/<subject>.test.ts`:

1. Paste the code from before the fix, from `git show <sha>^:<file>` — the
   exact lines, with a comment giving the line numbers. Add a case that names
   the sha (`it("flags … from before <sha>")`) and asserts the finding.
2. Paste the fixed code from `git show <sha>:<file>` and assert no finding.
3. Put the sha in the check's `provenance.incidents`.
4. Scan the whole parent file with the check once (a throwaway script under
   `/tmp`, not committed) and record the flagged line in the commit message.

```bash
pnpm --filter @carbon/checks exec vitest run src/provenance.test.ts src/conformance/<subject>.test.ts
```

Expect `Tests  N passed` and no `FAIL`. `src/provenance.test.ts` fails a check
whose test does not replay each declared sha with a finding, and a sha the
test cites that `incidents` leaves out. A new check never goes on its
`UNPROVEN_CHECKS` list.

| Result | Action |
|---|---|
| The parent code is not flagged | The check misses the real bug. Fix the check, not the fixture. 2 failed attempts → STOP and report the form it cannot read |
| The fix is flagged | The check is too strict. Same rule |

## Step 7: Baseline existing sites only

```bash
pnpm --filter @carbon/checks exec vitest run src/run.test.ts
```

It fails with `New conformance violations:` and one line per site,
`<checkId>  <file>:<line>  <snippet>`. Read every site. Fix the real ones
you can fix in scope; add the rest to
`packages/checks/src/conformance/baseline.json` as `"<checkId>::<file>::<snippet>"`,
one line each, in sorted position. Never run
`pnpm --filter @carbon/checks baseline` (it rewrites the file and grandfathers
everything; ask first). Then:

```bash
git diff --stat packages/checks/src/conformance/baseline.json
```

Expect only insertions (`N insertions(+)`, no deletions). Re-run the
`run.test.ts` command: `Tests  2 passed`. Never baseline a site your branch
added — fix it.

## Output

Write `.ai/runs/{YYYY-MM-DD}-repeated-mistakes-{slug}.md` in STE-80:

````markdown
# Repeated mistakes: {cause family}, {window}

Candidates: {n} (Step 1 command, pattern: `{pattern}`). Kept: {n}.

## {Root cause, one sentence}
- Fixes: {sha} {file}:{function}; {sha} …; live instance: {file}:{line} or none
- Existing guard: {check id / none}; fixes after it: {shas / none}
- Enforcement: {architecture | type | check `<id>` | database test `<path>`}, because {reason}
- Proof: parent of {sha} flagged at {file}:{line}; fix passes; `provenance.incidents`: [{shas}]
- Baseline: {n} entries added ({n} real, {n} false positives: {why})
- Guarded code: {functions → tests added to guarded-code.json / none}

## Not confirmed
- {cause}: {shas} — {why not: fewer than 3 independent fixes, no live instance}
````

## Done when

- [ ] The run file exists at the path above and every section is filled.
- [ ] Each confirmed cause has a guard, or a STOP reason in the run file.
- [ ] `pnpm --filter @carbon/checks test` passes.
- [ ] `git diff --stat packages/checks/src/conformance/baseline.json` shows insertions only.

## Failure → action

| Symptom | Action |
|---|---|
| `git show <sha>^:<file>` fails: the file moved | `git show --stat <sha>` for the old path, then `git show <sha>^:<old path>` |
| The fix is on another branch, not `origin/main` | Use it as a fix; `git show` works on any fetched sha |
| You want to baseline a site to make the gate pass | Red flag. Only sites that exist on `origin/main` go in the baseline |
| "The check can't see this form, I'll leave it to review" | Record the form under the cause as a known hole; do not claim the cause is covered |
