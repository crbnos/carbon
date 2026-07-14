---
name: writing-skills
description: House guide for creating or editing agent skills in this repo (.ai/skills/). Use when writing a new skill, restructuring an existing one, or reviewing skills for quality. Covers the frontmatter contract, the install wiring, the house template, and the weak-executor writing rules every Carbon skill follows.
---

# writing-skills — how Carbon skills are written

Source of truth is `.ai/skills/{name}/SKILL.md`. The installer
(`.ai/scripts/install-skills.sh`, run automatically by `pnpm prepare` or
manually via `pnpm install-skills`) symlinks each skill directory into
`.claude/skills/` and `.codex/skills/`. Never edit under `.claude/` or
`.codex/` — edit `.ai/skills/` only.

## The prime directive: write for the weakest executor

Assume the model executing a skill is **much less capable than you** and has
zero context. It will not infer intent, fill gaps, or exercise judgment. So:

1. **One canonical path per task.** Never offer options without declaring a
   default. "Choose what fits" is a gap; a weak model fills gaps badly.
2. **Exact commands with expected output.** Every verification is a command plus
   what its output must contain. "Verify it works" is not an instruction.
3. **Exact paths.** Never "the appropriate directory". Never a path you didn't
   confirm exists.
4. **STOP rules inline.** State explicitly when to stop and report instead of
   improvising ("2 failed attempts → STOP", "open question unresolved → STOP").
5. **Decision tables over prose.** Situation → action. A weak model can match a
   row; it cannot weigh an essay.
6. **Verified references only.** Every file, command, and skill a skill mentions
   must exist — run the command, `ls` the path, before writing it down. This
   includes claims inherited from an earlier version of the skill: re-verify
   them; the previous author may have been wrong. A reference to something that
   doesn't exist sends the executor into a loop.
7. **Close loopholes explicitly.** For discipline rules, list the specific
   workarounds that are forbidden and the red-flag phrases that mean "stop"
   ("just this once", "I'll test after", "keep it as reference").
8. **Announce at start.** Workflow skills open with one line naming the skill
   and its target. It locks the executor into the procedure and tells the
   supervising human which playbook is running.
9. **Non-interactive only.** Never instruct `git rebase -i`, `git add -i`,
   `git restore -p`, or anything that opens an editor/prompt — interactive
   commands hang in agent harnesses. Give the non-interactive equivalent.
10. **Bundle assets for generative output.** When a skill produces a styled
    artifact (HTML page, document scaffold), ship a filled-in template under
    `assets/` and have the executor copy + fill `<!-- FILL -->` markers —
    weak models fill templates far better than they invent structure.

## Frontmatter contract (hard requirements)

- The file **starts** with `---` on line 1. Nothing above it — an HTML comment
  above the frontmatter breaks description parsing and the comment leaks into
  the skill list. Attribution comments go **below** the closing `---`.
- `name:` must equal the directory name exactly (letters, numbers, hyphens).
  The installer symlinks by directory name; a mismatch disconnects the skill.
- `description:` ≤1024 chars, third person. Formula: *what it does and produces*
  + *"Use when …" concrete triggers* + *when NOT to use, pointing at the sibling
  skill that applies*. The description is the only thing the model sees before
  deciding to load the skill — triggers matter more than elegance.

## House template

```markdown
---
name: {dir-name}
description: {what it does/produces}. Use when {triggers}. Do not use for {adjacent case} — use /{other-skill}.
---

# {name} — {one-line purpose}

{2–3 sentences: input → output contract.}

**Announce at start:** "Using the {name} skill — {purpose}."

## Step 1: {imperative}
{exact commands, expected output}
...

## Output
{exact template the skill must produce, in a fenced block}

## Done when
- [ ] {verifiable item — a command result or an artifact at an exact path}

## Failure → action        {when the skill can fail mid-run}
| Symptom | Action |
```

Sizing: most skills 60–180 lines. Move heavy reference material (100+ lines) to
`references/*.md` inside the skill dir and say exactly when to read each file.
One excellent example beats three mediocre ones.

Formatting trap: when a template block in your skill must itself contain fenced
commands, use a **four-backtick outer fence** (`````` ````markdown ``````) — a
three-backtick fence inside a three-backtick fence closes the outer block early
and garbles everything after it.

## Canonical artifact paths (use these; never invent new ones)

| Artifact | Path |
|----------|------|
| Research findings | `.ai/research/{slug}.md` |
| Specs | `.ai/specs/{YYYY-MM-DD}-{slug}.md` |
| Implementation plans + progress | `.ai/plans/{YYYY-MM-DD}-{slug}.md` |
| Run logs (multi-step operation records) | `.ai/runs/{YYYY-MM-DD}-{slug}.md` |
| Browser playbooks | `.ai/playbooks/{slug}.md` |
| Improve handoff plans | `.ai/plans/improve/` |
| Ephemeral runtime output (screenshots, debug logs) | `.ai/scratch/` (gitignored) |

Command conventions every skill must respect: scoped typecheck only
(`pnpm exec turbo run typecheck --filter=<pkg>` — whole-repo OOMs), pnpm never
npm, `pnpm run generate:types` after migrations before typechecking, commits go
through `/check-and-commit`.

## Workflow for a new or edited skill

1. **Check overlap first.** Read `.ai/skills/README.md`. If an existing skill
   covers 70% of the job, extend it — two overlapping skills with different
   instructions is worse than one imperfect skill.
2. Write the skill per the template. Verify every reference (rule 6).
3. **Cold-read test.** Dispatch a subagent with only the skill text and a
   realistic task; watch where it stalls, improvises, or misreads. Every stall
   is a gap in the skill, not a flaw in the executor. Fix and repeat.
4. Re-run the installer and confirm the skill registers:
   ```bash
   pnpm install-skills && bash .ai/scripts/install-skills.sh --list
   ```
5. Update `.ai/skills/README.md` (the index) and, if the skill belongs in a
   pipeline, the root `AGENTS.md` Workflows table.

## Editing rules

- A skill that names a file, command, or flag that no longer exists is **stale**
  — fix it the moment you notice (`.ai/rules/keep-sources-in-sync.md`).
- Never weaken a STOP rule or a gate to make a run pass.
- When you change a skill's contract (inputs, outputs, artifact paths), grep
  `.ai/` and `AGENTS.md` files for inbound references and update them in the
  same change.
