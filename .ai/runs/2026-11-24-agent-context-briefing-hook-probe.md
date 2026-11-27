# Hook probe, 2026-11-24

Task 11 of `.ai/plans/2026-11-24-agent-context-briefing.md`. Two headless
sessions (`claude -p --permission-mode acceptEdits`) ran in this worktree with
the PreToolUse hook from Task 10. Both probe files were deleted afterwards.

## Probe 1: a refused write

The session tried to write `apps/erp/app/routes/x+/__probe.tsx` with
`import { redirect } from "react-router";`. The hook refused the write, and the
file was not created. The agent quoted this reason, word for word:

```
PreToolUse:Write hook error: Refused: this edit adds 2 new check violations.
- no-raw-redirect (line 1): Import redirect from @carbon/utils; use redirectExternal to leave this origin. Use instead: redirect, redirectExternal (@carbon/utils).
- spdx-license-header (line 1): Missing SPDX license header — run `pnpm --filter @carbon/checks license-headers`. Use instead: // SPDX-License-Identifier: AGPL-3.0-only / // SPDX-License-Identifier: LicenseRef-Carbon-Commercial.
```

Result: the refusal reaches the agent before the write. It names each check and
its fix.

## Probe 2: an allowed write

The session wrote `packages/utils/src/__probe.ts` with a license header and two
`.update(` calls. The hook allowed the write and returned the briefing in
`additionalContext`. The agent quoted it: 2 lessons, the `database-patterns`
and `write-time-checklist` summaries, and the broad rules by name.

The agent also reported the timing: "this text arrived after the Write call had
already succeeded, not before it."

Result: `additionalContext` on PreToolUse reaches the agent, but with the tool
result, after the write. The docs describe the field as "added to Claude's
context alongside the tool result". So on an allowed write, the briefing
arrives one step late. The agent can correct the file in its next edit, but it
did not know the rules before the first write.

## What works and what does not

| Path | Before the write? |
|---|---|
| Refusal (`permissionDecision: "deny"`) | Yes |
| Briefing on an allowed write (`additionalContext`) | No, it arrives with the result |
| `pnpm brief <files>` from a skill or `AGENTS.md` | Yes, when the agent runs it first |

## Options to deliver the briefing before the first write

1. Add a PostToolUse hook on `Read`. The Edit tool requires a Read of an
   existing file first, so a briefing attached to the Read result arrives
   before every edit of an existing file.
2. Refuse the first write of a new file once, with the briefing as the reason.
   The agent then sends the same call again, and the hook allows it.

Neither option is in the plan. They need a decision from the human.
