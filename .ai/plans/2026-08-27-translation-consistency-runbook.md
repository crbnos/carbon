# Runbook — repair translation terminology, one language at a time
---

## What we are fixing

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

| What you need                                                | Command                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Is this a domain term, and what is its approved translation? | `node .claude/skills/translate/scripts/glossary-lookup.mjs --term Job --locale zh`                |
| Which terms appear in this English string?                   | `node .claude/skills/translate/scripts/glossary-lookup.mjs --scan "Delete this job?" --locale zh` |
| How much of the glossary is filled per language?             | `node .claude/skills/translate/scripts/glossary-lookup.mjs --coverage`                            |
| Which translations disagree with the glossary?               | `node .claude/skills/translate/scripts/check-glossary.mjs --locale zh`                            |
| The same, machine-readable                                   | `node .claude/skills/translate/scripts/check-glossary.mjs --locale zh --json`                     |
| Preview what would be cleared                                | `node .claude/skills/translate/scripts/reset-violations.mjs --locale zh --dry-run`                |
| Clear the disagreeing translations                           | `node .claude/skills/translate/scripts/reset-violations.mjs --locale zh`                          |
| Refill every empty translation                               | the **`/translate` skill** (not a script — it fans out to cheap subagents)                        |
| Strip catalog churn before committing                        | `pnpm run lingui:clean`                                                                           |
| Confirm nothing is left empty                                | `pnpm exec linguito check`                                                                        |

Two rules about these:

- **Never edit `packages/locale/locales/glossary.json` mid-run.** It is the
  source of truth for every language at once, so changing it while a language is
  in flight silently changes what the checker measured five minutes ago. Term
  changes happen in Phase 0, as their own reviewed decision, before any language
  starts. If a term looks wrong once you are past Phase 0, record it in the
  ledger and stop — do not change it yourself.
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

**Only 30 of the 448 terms carry an `ambiguity` note today**, so "enforced" is
currently far wider than "unambiguous". That is what Phase 0 exists to fix, and
until it is done the enforced counts below overstate the real defect count.

---

## Phase 0 — fix the glossary BEFORE any language (do this once)

Learned the hard way on the zh run: the checker matches a bare English word with
no sense of context, and the SAME matcher builds the word list the Haiku
subagent is ordered to obey. So a term missing its `ambiguity` note does not
merely produce a noisy report — it tells a small model to write the wrong word.
The small model cannot push back; that is the whole reason the glossary exists.

Concrete misses from the zh run, all reported as hard defects when the Chinese
was right: `Pick another field` (ordinary verb, not warehouse 拣货),
`inventory transactions` (the plain noun, not the module title 库存管理),
`bill of materials` (items, not raw stock 原材料), `Setup Map`
(onboarding, not machine changeover 换型), `a traceable standard`
(not the AQL level 正常检验), `the right person`, `maintenance schedule`,
`open the document`, `Closed at`.

**These false positives are identical in every language** — they come from the
English side of the matcher, so `de`, `ja`, `ru` and the rest will hit exactly
the same ones. Fixing the glossary once removes them from all twelve runs;
skipping it means paying to blank and re-translate correct strings twelve times,
and shipping worse text each time.

Drafted wording for the 16 worst terms is in
`.ai/runs/translation-consistency/glossary-ambiguity-draft.md`. Adding a note is
a reviewed decision — get the user's sign-off, apply, then re-measure the
backlog before choosing a language.

**Status: done on 2026-08-27.** 31 notes added across two rounds, taking the
glossary from 30 noted terms to **61**:

- Round 1 (`8426a12e6`) — `Inventory`, `Open`, `Pick`, `Material`, `Total`,
  `Standard`, `Posted`, `View`, `Setup`, `Planned`, `Closed`, `Picked`, `Move`,
  `Schedule`, `Person`, `Items`, plus the placeholder-masking fix.
- Round 2 (`afac560b9`) — statuses and actions that double as ordinary verbs:
  `Close`, `Active`, `Assigned`, `Released`, `Disposed`, `Team`, `Credit`,
  `Consumed`, `Rejected`, `Pass`, `Split`, `Ordered`, `Role`, `Monthly`, `Buy`.

Backlog after Phase 0, with NO translation work in between — measure from these,
not from the pre-Phase-0 table below:

```
ja 2296   ru 2155   ko 1727   de 1623   fr 1348   zh 103
```

(zh also had its catalogs repaired, `3c9315ce3`; the others are untouched, so
their drop is purely the checker no longer crying wolf.)

One divergence fixed at the same time: `Item` had an `ambiguity` note and `Items`
did not, so the same sentence passed or failed depending on which form the
English used. `Items` got a mirroring note. Do NOT "simplify" this by folding
`Items` into `Item` as an `englishVariants` — their translations genuinely differ
in six locales (`fr` Article/Articles, `pt` Item/Itens, `tr` Stok kartı/Stok
kartları, and `es`/`it`/`pl`), because `Items` is the plural module name.

Not solvable with a note, and still open: **negation**. `{0} problems — not
published` is translated 未发布 ("not published") and rejected for lacking
已发布 ("published"). That needs checker logic, and it is easy to get wrong.

---

## Do one language per run

Backlog of enforced violations as first measured on 2026-08-27, BEFORE Phase 0.
**Historical only — do not plan against these.** Use the post-Phase-0 numbers in
the section above.

```
ja 2837   ru 2569   ko 2204   de 2091   zh 2069   pl 1869
hi 1871   fr 1797   tr 1680   pt 1558   it 1485   es 1282
```

They are kept as the record of how much of an "enforced violation" count can be
the checker rather than the translation: `zh` went 2069 → 103, and roughly half
of that came from Phase 0 alone.

Finish a language end to end, commit it, and **stop and ask the user before
starting the next one**. This is a hard gate, not a courtesy: one language is
~1,000–2,300 strings, which is already a large diff; two is unreviewable, and a
failure halfway through leaves both in an unknown state. It is also the only
point where a human sees what the terminology actually produced before the next
language repeats it.

At that gate, report: the before/after enforced count, how many strings changed,
the commit hash, what the residual is made of, and the remaining backlog. Then
wait. Do not start the next language on your own initiative, even if the user
previously said "do them all" — that is the instruction to work through the
list, not permission to skip the gate.

## The order

`zh` went first because a real Chinese customer reported the bug, so it is the
one language where feedback on the fix is available. It is **done**
(`3c9315ce3`).

Remaining, and the order to take them in:

```
de 1623   ja 2296   ru 2155   ko 1727   pl 1538   hi 1509
fr 1348   tr 1292   pt 1257   it 1177   es 990
```

`de` is deliberately NOT the biggest. It goes next because it is the first
Latin-script language through this pipeline, and Latin-script languages take a
completely different code path in the checker: CJK matches the approved term
whole, everything else matches on a ~60% stem prefix (`stemOf` in
`lib-glossary.mjs`) so an inflected form still passes. German is the most
inflection-heavy and compound-heavy of the large backlogs, so it is the best
stress test of a path `zh` never touched. Find the stem bugs on the language
most likely to expose them, before spending five more languages on them.

After `de`, work down by size.

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
- [ ] Phase 0 — glossary ambiguity notes applied (once, repo-wide)
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

**It is overwritten on every run**, so a second pass over the same locale
destroys the first pass's record. The reliable undo for a whole run is
`git checkout packages/locale/locales/<locale>/` — nothing is committed until
Phase 5. Do not rely on the JSON alone.

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

Three things the zh run hit that the skill's own docs do not warn you about:

- **`extract-missing.mjs` has no `--locale` flag** — it always chunks all twelve
  locales. To honour one-language-per-run, read
  `.ai/scratch/translate/manifest.json` and dispatch only the entries whose
  `locale` matches yours. The other locales' chunks stay unwritten, which is
  fine: the merge skips them.
- **Skip `pnpm run lingui:extract`** unless source strings actually changed. You
  are refilling existing entries, and on this branch it dumps a large unrelated
  catalog diff that breaks Phase 4's "only `msgstr` changed" check.
- **Read the merge output's `Missing/invalid chunk outputs` list.** A subagent
  that writes unparseable JSON has its whole chunk dropped in silence — 3 of 44
  chunks failed this way on the zh run, 120 strings, all of it from bare ASCII
  `"` inside a value. The retry round catches them; not reading the list means
  you never learn they were dropped.

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

`linguito check` is repo-wide and was **already red before this work started**
(~52 pre-existing empty strings per locale, ~572 across the eleven you are not
touching), so it cannot pass on a single-language run and is not a gate here.
Check your own locale directly instead — one hit per file is the PO header:

```bash
grep -c '^msgstr ""$' packages/locale/locales/<locale>/erp.po packages/locale/locales/<locale>/mes.po
```

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

The zh run proved this out: 2069 → 513 after one pass, → 406 after two, and
sampling the residual showed it was almost entirely Phase 0 material rather than
bad Chinese. A third pass would have blanked correct translations and paid a
model to make them worse. **Read a dozen residuals before you decide** — if they
are ordinary English words used in a non-ERP sense, the answer is a glossary
note, not another pass.

Expect to land with a residual, not a zero, until Phase 0 is done. Say so
plainly rather than letting the count read as remaining defects.

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
and what the remaining backlog is — then wait for them to say go.

---

## Honest limits — tell the user these, do not paper over them

- This fixes **terminology only**. A translation that is wrong for some other
  reason is invisible to the checker, which only knows the 448 glossary terms.
- The checker reads the ENGLISH with no sense of context, so a term without an
  `ambiguity` note flags correct translations as defects — and pushes the
  subagent to write the wrong word. Until Phase 0 lands, "enforced" does not
  mean "defect". Never quote an enforced count as a defect count.
- Roughly **71% of strings** contain a glossary term. The other 29% are
  unconstrained and can still drift.
- The approved terms were chosen by a model, not a native speaker. They are
  consistent and domain-aware, but unverified by a human. Chinese is the one
  language where a real customer can confirm them — ask.
- `nl` is excluded everywhere: it is not in `supportedLanguages` and its catalog
  is stale.
