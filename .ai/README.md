# .ai

Working files for agents. The code and the schema are the source of truth. These
files describe them (see `.claude/rules/keep-sources-in-sync.md`).

| Path | Holds | Keep it when |
|---|---|---|
| `lessons.md` | Pitfalls, in the `Context → Problem → Rule → Applies to` format | Always |
| `ds-rules.md`, `docs/` | Design system rules, domain and system docs | The thing they describe exists |
| `specs/` | Live designs. `implemented/` holds shipped designs, `archived/` superseded ones (see `specs/AGENTS.md`) | Always |
| `research/` | Competitor and industry surveys | Always |
| `playbooks/` | Cached browser test flows that `/test` reuses | The flow exists |
| `plans/` | Implementation plans | The work is not finished, the plan has *Execution notes*, or something names it |
| `runs/` | Run logs. `runs/<id>/` holds harness run artifacts (`packages/harness/src/layout.ts`) | The run is recent, or something names it |
| `reviews/` | Point-in-time reviews | Something names it |
| `issues/` | Deferred issues | The issue is open |
| `scripts/` | Agent tooling | Something uses it |
| `scratch/` | Runtime output, gitignored | Never commit it |

## Removing a file

Git keeps the history, so a finished plan or an old run log does not need to stay
in the tree. Before you remove one:

1. Search the repo for its full path and its bare filename. Do not remove a file
   that a rule, an `AGENTS.md`, source code, or a kept `.ai` file names.
2. Do not trust checkboxes alone. Many plans shipped with their boxes unticked. A
   plan is finished when every box is ticked or its spec is in `specs/implemented/`.
3. Keep *Execution notes*. They are the only record of why the build left the plan.
