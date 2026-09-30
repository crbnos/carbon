# Agent: refactor and cleanup (pass 2)

Branch `fix/agent-server-history`, after the AI SDK v7 upgrade. Behaviour is preserved except
where a line says otherwise.

## Tasks

- [x] **Delete the v2 data-tool scaffolding** (user decision). `agent.config.ts`, the
  `search_tools` / `describe_tool` / `call_tool` tools, the v2 prompt branch, the tool
  metadata imports, `agent.tools.test.ts` (it only tested the gated tools). Git history
  keeps it; v2 needs an approval-gate design anyway.
- [x] **One place turns stored rows into messages.** `agent.history.ts` gets
  `toDisplayMessages` next to `buildModelHistory`; the thread loader returns UIMessages, and
  `useAgentThread` drops its own `DbPart` types, `reconstructMessages` and the cast.
- [x] **navigate reports what happened.** The tool resolves the page on the server
  (`resolvePage`, params URL-encoded) and returns `{ url }` or an error the model can act on;
  the browser navigates to the returned url. Before: always `{ navigated: true }`.
- [x] **Today's date in the company timezone** in the system prompt (`datetime.today(tz)`),
  not `new Date()` (UTC, banned server-side).
- [x] **Split the engine from data access.** `agent.service.ts` keeps thread/message reads
  and writes; the streaming turn, titling, persistence and rate limit move to
  `agent.server.ts` (server-only, not in the barrel).
- [x] **Titling from the loaded history**, not two more queries.
- [x] **Routes log and report failures** (`threads.ts` create/delete/list).
- [x] Typecheck, agent tests, biome; live check: ask, follow-up, navigate, history, feedback.
- [x] Update `agent-knowledge-base.md` / `chat-ai-sdk-info.md`.

Found on the way: the MRP v2 spec planned to enable the removed data tools; its two lines
now point at the deleting commit (user confirmed the deletion). The dev block viewer's
Navigate fixture was already broken (old input shape) and is removed.

Not in this pass: translating the panel's strings (Lingui) — say so to the user.
