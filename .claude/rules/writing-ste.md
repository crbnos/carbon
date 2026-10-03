---
paths:
  - ".ai/specs/**"
  - ".ai/plans/**"
  - ".ai/research/**"
  - ".ai/runs/**"
---

# Writing style for specs, plans and explainers — "STE-80"

Prose in `.ai/specs/`, `.ai/plans/`, `.ai/research/`, `.ai/runs/`, every
`/explain` page, and the hand-off message that presents any of them follows
**STE-80**: about 80% of the way to ASD-STE100 Simplified Technical
English, the controlled language that aerospace maintenance manuals use. The
full standard is too strict for design work. STE-80 keeps the rules that make
text easy to read and drops the rules that would distort Carbon's vocabulary.

Why: a reader must understand a spec or a plan fast and in one pass. Long
sentences, passive voice and noun stacks hide who does what. A weak executor
model also follows short, literal instructions much better than an essay.

Scope: prose only. Code, SQL, identifiers, commands and quoted error text stay
exact.

## The rules (keep these)

| # | Rule | Limit |
|---|------|-------|
| 1 | Procedural sentence (an instruction) | max **20 words** |
| 2 | Descriptive sentence (a fact, a reason) | max **25 words**; a rationale may go to 30 |
| 3 | One instruction per sentence | split "do X and then do Y" into two steps |
| 4 | Instructions use the imperative | "Run the migration.", not "The migration should be run." |
| 5 | Active voice | name the actor: "The trigger sets `status`", not "`status` is set" |
| 6 | Paragraph | max **6 sentences**, one topic |
| 7 | Sequence of actions | numbered vertical list, one action per item |
| 8 | Condition before action | "If the job is Paused, skip it." |
| 9 | Warning before the step it guards | put the 🛑 / caution line first, then the step |
| 10 | One word, one meaning | pick a term and keep it; never alternate synonyms for variety |
| 11 | Simple word over complex word | use, start, end, help, show, about — not utilize, commence, terminate, facilitate, demonstrate, approximately |
| 12 | No noun clusters longer than 3 words | "the date the supplier confirms the order", not "supplier order confirmation date value" |
| 13 | Keep articles | write "the", "a"; telegraphic text ("Update row, return id") is allowed only inside numbered Steps lists and task `<summary>` lines |
| 14 | Simple tenses | present for facts, imperative for instructions, future only for planned behavior |
| 15 | No vague quantities | a number, a column name, or a named state — never "some", "various", "etc.", "as appropriate" |

## The 20% we drop (Carbon exceptions)

- **Domain terms are approved words.** Use the canonical term from
  `docs/content/src/glossary/terms.ts` (Make to Order, Pull from Inventory,
  Backflush, Lineside, Supersession) even when STE's dictionary has no entry for it. Do not
  replace a domain term with a "simpler" word — that creates rule 10 violations.
- **Identifiers in code font are approved words.** `jobMaterial`,
  `settleConsumeFirstLines`, `companyId` count as one word each.
- **`-ing` forms and phrasal verbs are allowed** when the alternative reads
  worse ("set up", "picking list"). STE forbids them; STE-80 does not.
- **Tables are preferred over prose** for any comparison, decision or mapping.
  A table cell does not need to be a full sentence.

## Before → after

| Before | After (STE-80) |
|--------|----------------|
| "It should be noted that in the event that the predecessor has insufficient stock to cover a whole assembly, the line will be redirected to the successor." | "If the predecessor's stock covers no whole assembly, the line moves to the successor." |
| "Utilize the existing service function to facilitate retrieval of the data." | "Use `getJobMaterialItemIds` to read the item ids." |
| "Validation and persistence of the supplier quote line price break quantity value occurs in the action." | "The route action validates the quantity of each price break. Then it saves the row." |
| "Various edge cases etc. should be handled appropriately." | "Handle 3 cases: quantity 0, a deleted item, and a cancelled job." |

## Enforcement — every time, no exceptions

STE-80 is a gate, not a guideline. It applies to every file you write or
change under `.ai/research/`, `.ai/specs/`, `.ai/plans/` and `.ai/runs/`, and to
the message that hands any of them to the human. It applies in every mode:
supervised, autonomous `/feature`, `/conductor`, and headless runs.

**STE-80 is the author's job, never the human's.** The human reviews the
decisions in a document. The human never checks its style. So:

- Write in STE-80 from the first sentence. Never draft in ordinary English
  with a plan to convert it later.
- Finish the review pass below yourself, before the human sees the file.
- Never ask the human to check STE-80, and never hand off a file "for an
  STE-80 review". If you cannot make a passage pass, rewrite it until it does.
- Never report a file as done while one self-check box is still unticked.

### Write-time habits

Use these as you write each sentence, not afterwards:

1. Start with the actor: "The route action saves the row", "SAP prints the certificate".
2. One fact or one instruction per sentence. Put a full stop where you would write "and".
3. Put the condition first: "If X, do Y."
4. Turn every sequence into a numbered list as you write it.
5. Use the term you used before. Do not switch to a synonym.
6. Write a number or a name, never "some", "various" or "etc.".

### The review pass

Do the **STE-80 review pass** on each such file before you hand it off or
mark a phase done. Do it again after every later edit to the file.

1. Read the whole file, one paragraph at a time. Skip code blocks, SQL,
   tables, headings and the Sources list.
2. For each sentence that runs past about two lines, count its words. A word
   in code font counts as one word.
3. Split each instruction over 20 words and each descriptive sentence over 25
   words. A rationale may go to 30.
4. Find each "is / are / was / were / be / been + past participle". If it hides
   who acts, rewrite it with the actor as the subject.
5. Split each paragraph that has more than 6 sentences.
6. Search the file for "etc.", "various", "some", "as appropriate", "TBD",
   "utilize", "facilitate", "approximately". Replace each one with a number,
   a name or a simpler word.
7. List the key terms of the document. Make sure each concept has one name only.
8. Do the self-check list at the end of this file. Tick every box before you
   continue.

**Subagent output is raw material, not finished prose.** A subagent does not
follow this rule unless you tell it to, and it writes its report for you, not
for the reader. So:

1. In every subagent prompt that returns prose for a document, add: "Write your
   report in STE-80 (`.claude/rules/writing-ste.md`)."
2. When the result arrives, never paste it into the document as it is. Rewrite
   each part in STE-80 and in the document's own terms.
3. After you merge a subagent's result into a document, do the STE-80 review
   pass on that document again, before any other step.
4. If a subagent edits a document directly, do the review pass on that
   document yourself when the subagent reports back. Do not trust the
   subagent's own claim that the prose is clean.
5. Check the facts too. A rewrite can turn a careful claim into a false
   general one ("ProShop and E2 print it" → "all products print it").

Red flags — each one means you are about to skip the gate:

- "The subagent's summary is already clear, I'll paste it."
- "It's only the research file; the spec is what people read."
- "Autonomous mode, no reviewer, I'll check at the end."
- "The subagent says it followed STE-80, so I can skip the review pass."
- "It's a small edit, no need for another review pass."

## Self-check before you finish a document

- [ ] No instruction sentence over 20 words, no descriptive sentence over 25 (30 for a rationale)
- [ ] No passive sentence that hides the actor
- [ ] Every multi-step action is a numbered list
- [ ] Each concept has exactly one name in the whole document
- [ ] No "etc.", "various", "as appropriate", "TBD"
