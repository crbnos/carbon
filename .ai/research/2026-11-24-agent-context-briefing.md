# Research: agent context briefing before a write

For spec `.ai/specs/2026-11-24-agent-context-briefing.md`. This is developer
tooling, not an ERP feature, so there is no competitor survey. The facts below
come from the Claude Code docs and from this repository.

## Claude Code facts (docs, read 2026-11-24)

Sources: https://code.claude.com/docs/en/hooks and
https://code.claude.com/docs/en/memory.

| Fact | Effect on the design |
|---|---|
| A rule with `paths:` loads when Claude reads, writes or edits a matching file (also through `cat` or `head` in Bash). | Path scoping already works for files the agent opens. |
| A rule without `paths:` loads at launch, in every session. | A rule must never lose its `paths:`. The 89 rules hold about 485k tokens. |
| `paths` is the only frontmatter field Claude Code reads. It ignores other fields without an error. | New fields (`triggers:`, `summary:`) are safe to add. |
| If the frontmatter YAML does not parse, the rule loads as if it had no `paths:`. | A test must parse every rule's frontmatter. |
| A PreToolUse hook gets `tool_name`, `tool_input` (`file_path`, `content` for Write; `old_string`, `new_string` for Edit) and `session_id` on stdin. `file_path` is absolute. | The hook can match the planned edit, not only the file on disk. |
| A PreToolUse hook adds text to the context through `hookSpecificOutput.additionalContext`. Plain stdout with exit 0 does not reach Claude. | The hook must print JSON. The docs describe this field only in summary, so the plan must test it first. |
| A PreToolUse hook can refuse the tool call with `permissionDecision: "deny"` and a reason that Claude reads. | A hook can stop a write that a check would fail, before the write. |
| A command hook times out after 600 s by default. A timed-out PreToolUse hook does not block the tool call. | A slow or broken hook never stops work. |

## Repository facts (2026-11-24)

| Item | Count or shape |
|---|---|
| Rules in `.claude/rules/` | 89, all with `paths:`. Median about 3.4k tokens, largest about 26.6k. |
| Conformance checks in `packages/checks` | 51. Each has `id`, `description` and `provenance.replacedBy`. `run.ts` groups them by file set: migrations (`CONFORMANCE_CHECKS`), server TypeScript (`SERVER_CHECKS`), all TypeScript (`TS_CHECKS`), tests (`TEST_CHECKS`), edge functions, and structure. |
| Lessons in `.ai/lessons.md` | 421 entries, 5,302 lines, about 140k tokens. 428 "Applies to" lines; 259 name a file path, the rest name only a topic. 77 commits changed the file in the last month. |
| Codex | `.ai/scripts/install-skills.sh` copies rules and skills to `.codex/`. Codex does not read `paths:` and does not run Claude hooks. |
| Hooks | The repository has no hook configuration. |

## Example of a topic that path scoping misses

The transaction guidance is in root `AGENTS.md`, in `database-patterns.md`
(scoped to `packages/database/**` and `*.service.ts`) and in about 5 lessons.
The lesson "Chained Supabase writes in a route action are not a transaction"
is about route files, which the rule's paths do not cover.
