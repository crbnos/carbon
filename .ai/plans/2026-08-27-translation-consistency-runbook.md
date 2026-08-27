# Runbook — repair translation terminology, one language at a time

**Paste this whole file to an agent as its instructions.** It is written to be
resumable: every phase records what it did before moving on, so a lost
connection costs you one phase, never the run.

---

## What you are fixing

Carbon's UI is translated into 12 languages. Those translations were produced by
a cheap model with no domain context, so the same English term came out
differently depending on which chunk translated it — Chinese rendered "Job" six
ways across 165 strings, and often chose the wrong ERP word entirely (工作,
"employment", instead of the shop-floor work-order term).

`packages/locale/locales/glossary.json` now holds **448 approved domain terms in
all 12 languages**. The repair is: find every translated string that disagrees
with the approved term, blank it, and re-translate it with the glossary attached.

**Do not delete whole catalogs and start over.** Blanking everything produces an
88,000-line diff nobody can review and re-spends on strings that are already
fine. The tooling is built around fixing only what is wrong.

---

## The tools (do not write your own)

All paths are relative to the repo root. Run everything from the repo root.

| What you need | Command |
|---|---|
| Is this a domain term, and what is its approved translation? | `node .claude/skills/translate/scripts/glossary-lookup.mjs --term Job --locale zh` |
| Which terms appear in this English string? | `node .claude/skills/translate/scripts/glossary-lookup.mjs --scan "Delete this job?" --locale zh` |
| How much of the glossary is filled per language? | `node .claude/skills/translate/scripts/glossary-lookup.mjs --coverage` |
| Which translations disagree with the glossary? | `node .claude/skills/translate/scripts/check-glossary.mjs --locale zh` |
| The same, machine-readable | `node .claude/skills/translate/scripts/check-glossary.mjs --locale zh --json` |
| Preview what would be cleared | `node .claude/skills/translate/scripts/reset-violations.mjs --locale zh --dry-run` |
| Clear the disagreeing translations | `node .claude/skills/translate/scripts/reset-violations.mjs --locale zh` |
| Refill every empty translation | the **`/translate` skill** (not a script — it fans out to cheap subagents) |
| Strip catalog churn before committing | `pnpm run lingui:clean` |
| Confirm nothing is left empty | `pnpm exec linguito check` |

Two rules about these:

- **Never edit `packages/locale/locales/glossary.json`.** It is the source of
  truth and it is already filled and reviewed. If a term looks wrong, record it
  in the ledger and tell the user — do not change it yourself.
- **Never hand-edit a `.po` file.** Blanking is `reset-violations.mjs`; filling
  is `/translate`. Both are deterministic; a hand edit is not.

---

## Enforced vs advisory

`check-glossary.mjs` reports two kinds of disagreement:

- **Enforced** — the term has one meaning, so a mismatch is a real defect. These
  are what you fix.
- **Advisory** — the term also has a non-domain English sense (`Part` inside
  "part of", `Make`/`Buy` as ordinary verbs, `Line` as an address line). A
  mismatch here is often correct. `reset-violations.mjs` skips these by default
  and you should leave that default alone.

The checker matches on the word's stem, so a correctly inflected form passes
(German `Auftrag` → `Aufträge`, Russian `заказ` → `заказа`). A translation is
supposed to inflect the approved term, not paste it in.

---

## Do one language per run

Current backlog of enforced violations (measured 2026-08-27):

```
ja 2837   ru 2569   ko 2204   de 2091   zh 2069   pl 1869
hi 1871   fr 1797   tr 1680   pt 1558   it 1485   es 1282
```

**Start with `zh`** — there is a real Chinese customer who reported this, so it
is the one language where you will get feedback on whether the fix worked.

Finish a language end to end, commit it, and stop. Do not begin a second
language in the same run. One language is ~1,500–2,800 strings, which is already
a large diff; two is unreviewable, and a failure halfway through leaves both in
an unknown state.

---

## The ledger — write this BEFORE you start

Create `.ai/runs/translation-consistency/<locale>.md` as your first action and
update it **after every phase**, not at the end. If the connection drops, this
file is the only thing that says where you were.

```markdown
# Translation consistency — <locale>

Started: <date>
Status: in-progress | blocked | done

## Phase log
- [ ] Phase 1 — baseline measured
- [ ] Phase 2 — violations cleared
- [ ] Phase 3 — re-translated
- [ ] Phase 4 — verified
- [ ] Phase 5 — committed

## Notes
(append findings, counts, and anything that looked wrong)
```

Tick a box only after that phase's command has actually run and you have read
its output. Never tick ahead.

---

## Phase 1 — Baseline

```bash
node .claude/skills/translate/scripts/glossary-lookup.mjs --coverage
node .claude/skills/translate/scripts/check-glossary.mjs --locale <locale> --max 15
git status --short packages/locale/
```

Record in the ledger: the approved-term count for this locale, the enforced and
advisory violation counts, and whether the working tree was clean.

**Stop and ask the user if:** the locale has 0 approved terms (nothing to check
against), or the working tree already has uncommitted `.po` changes (you would
mix someone else's work into your diff).

Read a few of the sample violations before continuing. If the *approved* term
looks wrong rather than the translations, stop — say so, and do not clear
thousands of strings against a bad term.

---

## Phase 2 — Clear the disagreeing translations

```bash
node .claude/skills/translate/scripts/reset-violations.mjs --locale <locale> --dry-run
```

Read the sample. Confirm the flagged strings really are using the wrong word.
Then run it for real:

```bash
node .claude/skills/translate/scripts/reset-violations.mjs --locale <locale>
```

This writes `.ai/runs/translation-consistency/reset-<locale>.json` containing
**every old value it cleared**. That file is your undo — do not delete it until
the language is committed and verified.

Record in the ledger: how many were cleared, per catalog, and the record path.

---

## Phase 3 — Re-translate

Invoke the **`/translate` skill**. Do not call the scripts by hand and do not
write your own translation loop — the skill handles chunking, attaching the
right glossary terms per chunk, dispatching cheap subagents, merging
deterministically, and retrying.

It fills only empty entries, so it will pick up exactly what Phase 2 cleared
(plus any that were already missing).

The skill has its own progress watcher and its own retry cap. Let it finish.

Record in the ledger: how many it filled, and any residual it reported.

---

## Phase 4 — Verify

```bash
pnpm run lingui:clean
pnpm exec linguito check
node .claude/skills/translate/scripts/check-glossary.mjs --locale <locale>
```

What each proves: `linguito check` proves nothing is **empty**; the glossary
check proves the filled ones **agree**. You need both — the original bug shipped
through a green `linguito check`.

Also confirm you changed only what you meant to:

```bash
git diff --no-color packages/locale/locales | grep -E '^\+' | grep -vE '^\+msgstr|^\+\+\+'
git diff --quiet packages/locale/locales/glossary.json && echo "glossary untouched"
```

The first must print nothing (only `msgstr` lines changed, no `msgid` touched).
The second must print `glossary untouched`.

**If enforced violations remain:** run Phase 2 and 3 once more for just those.
If a second pass does not clear them, stop and report — repeating a third time
means the approved term or the checker is wrong, not the translation.

Record in the ledger: final counts from all three commands.

---

## Phase 5 — Commit

Only when Phase 4 is green. Use the `/check-and-commit` skill, or commit the
`.po` files for this locale with a message like:

```
fix(i18n): apply approved glossary terminology to <locale>
```

Commit **only** `packages/locale/locales/<locale>/*.po`. Do not commit
`.ai/runs/`, and do not commit the glossary.

Then update the ledger to `Status: done` and **stop**. Do not start another
language. Tell the user which language is finished, how many strings changed,
and what the remaining backlog is.

---

## Honest limits — tell the user these, do not paper over them

- This fixes **terminology only**. A translation that is wrong for some other
  reason is invisible to the checker, which only knows the 448 glossary terms.
- Roughly **71% of strings** contain a glossary term. The other 29% are
  unconstrained and can still drift.
- The approved terms were chosen by a model, not a native speaker. They are
  consistent and domain-aware, but unverified by a human. Chinese is the one
  language where a real customer can confirm them — ask.
- `nl` is excluded everywhere: it is not in `supportedLanguages` and its catalog
  is stale.
