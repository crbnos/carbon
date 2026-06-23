---
name: self-review
description: Critically review your own PR work before or just after opening the PR. Use when finishing a branch, before opening or merging a PR, or to sanity-check a diff against main. Produces Must fix / Risks / Suggested improvements. Supports an opt-in strict "thermo-nuclear" mode for a deep maintainability and abstraction audit when explicitly requested.
---

Critically review your own PR work before or just after opening the PR.

Review the full branch diff, not just the most recent commit. If there is already an open PR for the current branch, use `gh pr view` and `gh pr diff`. If there is not, diff the current branch against `main` instead. If you already know the PR is open from earlier in the session, do not waste time re-proving it unless you need the PR number or metadata.

Read the entire diff carefully. Do not skim. Re-read any tricky sections until you understand why they changed. When something looks subtle, risky, or surprising, read the surrounding code too and make sure the change really makes sense in context.

As you review, actively look for problems and missing work:
- bugs or logic mistakes
- missing edge cases
- unnecessary complexity
- leftover debug code, logging, TODOs, or commented-out code
- naming that could be clearer
- inconsistent patterns
- dead code or accidental churn
- missing or weak tests
- risky changes that are not obvious from the diff
- PR scope/title/body not matching the actual change
- things that technically work but still feel brittle or hard to maintain

Be skeptical. Do not rubber-stamp your own work just because you wrote it.

Make notes as you go, then produce a concise review with these sections:
- Must fix
- Risks / questions
- Suggested improvements

Call out missing things too, not just bad things that are already present in the diff.

Be specific. Reference files and lines when possible. If you are not fully sure whether something is a real bug, include it anyway as a risk or question. Focus on what should be fixed, simplified, verified, or questioned before the PR is considered ready.

Present the findings directly to the user so they can decide what to act on.

## Strict mode (thermo-nuclear)

Run this mode **only when explicitly requested** — triggers like "thermo-nuclear", "thermonuclear", "deep code quality", "harsh", or "extremely strict" review. It raises the bar from "is this correct and shippable?" to "is this the simplest, most maintainable structure possible?"

Be **ambitious** about structure. Don't stop at local cleanup — actively hunt for "code judo" moves: behavior-preserving restructurings that make whole branches, helpers, modes, or layers disappear. Prefer deleting complexity over rearranging it; prefer the version that makes the code feel inevitable in hindsight.

Apply these non-negotiable standards on top of the base review:
1. **File growth** — Don't let a PR push a file from under 1k lines to over 1k without a strong reason. Treat it as a smell; prefer extracting helpers/modules first.
2. **No spaghetti growth** — Be suspicious of new ad-hoc conditionals, scattered special cases, or one-off branches bolted onto unrelated flows. Push logic into a dedicated abstraction / state machine / module instead of tangling an existing path.
3. **Clean the design, don't just accept working code** — If behavior can stay the same while structure gets meaningfully cleaner, push for it. Don't rubber-stamp "it works".
4. **Direct over magical** — Flag brittle, ad-hoc, or "magic" behavior; thin wrappers, identity abstractions, and pass-through helpers that add indirection without clarity.
5. **Type / boundary cleanliness** — Question unnecessary optionality, `any`, `unknown`, or cast-heavy code; prefer explicit typed models. Flag silent fallbacks that paper over unclear invariants.
6. **Canonical layer + reuse** — Call out feature logic leaking into shared paths or details leaking through APIs. Prefer existing canonical helpers over bespoke one-offs; push code to the package/module that owns the concept.
7. **Atomicity + orchestration** — Flag needlessly sequential flows that could run in parallel, and related updates that can leave state half-applied when a more atomic structure is obvious.

Prefer remedies that remove moving pieces: delete a layer of indirection, reframe the state model so conditionals vanish, change an ownership boundary so the feature becomes a natural extension of an existing abstraction, replace condition chains with a typed dispatcher, split a large file into focused modules.

**Strict approval bar** — treat each as a presumptive blocker unless clearly justified: structural regression; obvious missed simplification when a path is visible; unjustified file-size explosion; spaghetti-growth from special-case branching; hacky/magical abstraction; needless wrapper/cast/optionality churn; architecture-boundary leak or canonical-helper duplication. Be direct and demanding about quality without being rude.

End the response with a short TLDR that lists every item again in compact bullet form, grouped by section (`Must fix`, `Risks / questions`, `Suggested improvements`). Keep the TLDR concise and scannable.