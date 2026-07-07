# In-App Agent

> Status: draft
> Author: carbon-agent
> Date: 2026-07-01

## TLDR

Add an in-app AI agent to the ERP — a right-side chat panel that reuses our existing 1,249-tool surface (`direct-executor.ts` + `tool-metadata.json`), streams responses via Supabase Realtime, persists every turn with full tool-call fidelity, and gives us complete visibility into how people use it.

## Problem Statement

Carbon ships an MCP server that exposes every ERP tool over the MCP protocol. Users connect it to Claude Desktop for AI-assisted operations. This works, but we have **zero visibility**:

- No data on what questions users ask
- No data on which tools get called (or how often they fail)
- No cost tracking per conversation
- No quality signal on whether answers are good
- No insight into what workflows users attempt vs. complete

Previous in-app agent attempts lacked the infrastructure to match Claude + MCP. The delta isn't AI quality — it's persistence, streaming, tool discovery, context awareness, and monitoring.

## Proposed Solution

An in-app chat panel backed by a server-side streaming service that:
1. Wraps our existing tool surface in three Vercel AI SDK meta-tools
2. Persists every message and tool call to Postgres
3. Streams responses via Supabase Realtime (already wired up)
4. Sends browsing context (current page/record) with each message
5. Records telemetry to PostHog

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tool system | Meta-tools over `direct-executor.ts` | Reuses existing 1,249 tools with no new code per tool. Same pattern as MCP server. |
| Streaming transport | Supabase Realtime broadcast | Already in the app (`useRealtimeChannel`), handles auth and reconnection. No new infra. |
| State management | Zustand | Carbon already uses zustand. Scoped store for agent panel state. |
| Model | `gpt-4o` (default), user-selectable | Already in `pnpm-workspace.yaml` catalog (`@ai-sdk/openai`). Claude support addable later. |
| Background job vs inline | Inline first | Inngest adds latency. Start inline in the action handler; move to Inngest if request timeouts are a problem. |
| Turn entity | Omit initially | Turns can be derived from sequential user→assistant message pairs. Add `agent_chat_evaluation` table when LLM-as-judge grading lands. |
| Panel location | Right-side drawer | Matches existing `DetailSidebar` / properties panel pattern. Doesn't displace existing UI. |
| Telemetry | PostHog custom events | Already integrated. No new infra. |

## Data Model Changes

Three new tables. No changes to existing tables.

### `agent_chat_thread`

One row per conversation. Owned by a user within a company.

```sql
CREATE TABLE "agent_chat_thread" (
    "id" TEXT NOT NULL DEFAULT xid(),
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "totalInputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "conversationSize" INTEGER NOT NULL DEFAULT 0,
    "activeStreamId" TEXT,
    "modelId" TEXT NOT NULL DEFAULT 'gpt-4o',
    "archivedAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    CONSTRAINT "agent_chat_thread_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "agent_chat_thread_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_chat_thread_userId_fkey" FOREIGN KEY ("userId")
      REFERENCES "user"("id")
);

ALTER TABLE "agent_chat_thread" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_chat_thread_SELECT" ON "agent_chat_thread"
  FOR SELECT USING (has_role());
CREATE POLICY "agent_chat_thread_INSERT" ON "agent_chat_thread"
  FOR INSERT WITH CHECK (has_role());
CREATE POLICY "agent_chat_thread_UPDATE" ON "agent_chat_thread"
  FOR UPDATE USING (has_role());
CREATE POLICY "agent_chat_thread_DELETE" ON "agent_chat_thread"
  FOR DELETE USING (has_role());
```

### `agent_chat_message`

One row per message (user or assistant). Ordered within a thread.

```sql
CREATE TABLE "agent_chat_message" (
    "id" TEXT NOT NULL DEFAULT xid(),
    "threadId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "role" TEXT NOT NULL CHECK ("role" IN ('user', 'assistant', 'system')),
    "status" TEXT NOT NULL DEFAULT 'sent' CHECK ("status" IN ('sent', 'queued')),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT "agent_chat_message_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "agent_chat_message_thread_fkey" FOREIGN KEY ("threadId", "companyId")
      REFERENCES "agent_chat_thread"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX "agent_chat_message_threadId_idx"
  ON "agent_chat_message" ("threadId", "createdAt");

ALTER TABLE "agent_chat_message" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_chat_message_SELECT" ON "agent_chat_message"
  FOR SELECT USING (has_role());
CREATE POLICY "agent_chat_message_INSERT" ON "agent_chat_message"
  FOR INSERT WITH CHECK (has_role());
```

### `agent_chat_message_part`

Ordered content blocks within a message. Polymorphic — `type` discriminates the content.

```sql
CREATE TABLE "agent_chat_message_part" (
    "id" TEXT NOT NULL DEFAULT xid(),
    "messageId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL,
    -- Text content
    "textContent" TEXT,
    -- Tool call fields
    "toolName" TEXT,
    "toolCallId" TEXT,
    "toolInput" JSONB,
    "toolOutput" JSONB,
    "toolState" TEXT CHECK ("toolState" IN ('pending', 'running', 'success', 'error')),
    -- Error fields
    "errorMessage" TEXT,
    -- Timestamps
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT "agent_chat_message_part_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "agent_chat_message_part_message_fkey" FOREIGN KEY ("messageId", "companyId")
      REFERENCES "agent_chat_message"("id", "companyId") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "agent_chat_message_part_messageId_orderIndex_idx"
  ON "agent_chat_message_part" ("messageId", "orderIndex");

ALTER TABLE "agent_chat_message_part" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_chat_message_part_SELECT" ON "agent_chat_message_part"
  FOR SELECT USING (has_role());
CREATE POLICY "agent_chat_message_part_INSERT" ON "agent_chat_message_part"
  FOR INSERT WITH CHECK (has_role());
```

## API / Service Changes

### New Route: `api+/agent+/chat.ts`

React Router action that handles `sendMessage`, `stopStream`, `createThread`, `getThreads`, `getMessages`.

### New Service: `modules/agent/agent.service.ts`

Server-side chat service. Core functions:

- `createThread(client, userId, companyId)` → thread record
- `sendMessage(client, threadId, text, browsingContext, modelId)` → saves user message, starts stream, returns `{ messageId, streamId }`
- `streamChat(client, threadId, messages, context, modelId)` → calls `streamText()` with meta-tools, publishes chunks via Supabase Realtime, persists assistant message on completion
- `stopStream(client, threadId)` → sets abort signal
- `getThreads(client, userId)` → list threads
- `getMessages(client, threadId)` → list messages with parts

### New Service: `modules/agent/agent.tools.ts`

Three meta-tools wrapping the existing tool surface:

```typescript
import { tool } from "ai";
import { z } from "zod";
import toolMetadata from "~/routes/api+/mcp+/lib/tool-metadata.json";
import { executeFunction } from "~/routes/api+/mcp+/lib/direct-executor";

export function createAgentTools(ctx: ExecutorContext) {
  return {
    search_tools: tool({ ... }),   // searches tool-metadata.json
    describe_tool: tool({ ... }),  // returns schema from tool-metadata.json
    call_tool: tool({ ... }),      // delegates to executeFunction()
  };
}
```

### New Service: `modules/agent/agent.prompt.ts`

System prompt builder. Composes:
1. Base instructions (Carbon context, manufacturing domain, tool workflow)
2. Tool catalog summary (15 modules × tool counts)
3. Browsing context (injected into last user message, not system prompt)

## UI Changes

### New Components: `modules/agent/ui/`

| Component | Purpose |
|-----------|---------|
| `AgentPanel` | Right-side drawer (toggled by Cmd+J or topbar button) |
| `AgentMessageList` | Scrollable message list |
| `AgentMessage` | Single message bubble (user or assistant) |
| `AgentTextPart` | Markdown renderer for text parts |
| `AgentToolStep` | Expandable tool call/result display |
| `AgentErrorPart` | Error display |
| `AgentInput` | Textarea + send/stop buttons |
| `AgentContextBar` | Current page context + token usage |
| `AgentToggleButton` | Sparkle icon in topbar |

### New Hook: `modules/agent/hooks/useBrowsingContext.ts`

Derives browsing context from React Router location + params:

```typescript
// /x/part/:partId → { type: 'record', object: 'part', id: partId }
// /x/work-order/:woId → { type: 'record', object: 'workOrder', id: woId }
// /x/sales/quotes → { type: 'list', object: 'quote' }
```

Sent with each message. Only sent when it changes between messages.

### New Store: `stores/agent.ts`

Zustand store for agent panel state: open/close, current thread, messages, streaming state.

### Layout Change: `components/Layout/`

Add `AgentPanel` alongside existing content in the `x+/_layout.tsx` shell. Toggle button in `Topbar`.

## Acceptance Criteria

- [ ] User can open agent panel via hotkey (Cmd+J) or topbar button
- [ ] User can send a message and receive a streamed response
- [ ] Agent can discover and call any of the 1,249 ERP tools via meta-tools
- [ ] Every message and tool call is persisted to Postgres with full fidelity
- [ ] Agent receives browsing context (current page/record) with each message
- [ ] Tool calls render as expandable steps showing name, input, output, and duration
- [ ] User can start a new thread
- [ ] User can view thread history
- [ ] Token usage is tracked per thread
- [ ] PostHog events fire for: message sent, tool called, stream completed
- [ ] Stream can be stopped by the user
- [ ] RLS: users only see their own threads

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Inline streaming blocks server process on long turns | Med | Start inline, move to Inngest if timeouts occur. Vercel serverless has 60s limit on Pro, 300s on Enterprise. |
| Supabase Realtime latency for streaming chunks | Low | Broadcast is fast (~50ms). If noticeable, add thin SSE endpoint later. |
| 1,249 tools overwhelm the model's tool-calling ability | Low | Meta-tool pattern keeps prompt small. Model discovers schemas on demand. Same pattern works in MCP. |
| Context window exhaustion on long conversations | Med | Track `conversationSize`. Phase 2 adds pruning at 90% of context window. |
| Cost runaway | Low | Track tokens per thread. Phase 2 adds per-company daily budget. |

## Open Questions

> HARD STOP: Do not proceed with implementation until these are answered.

- [ ] **Model selection**: Default to `gpt-4o` only, or also wire up Claude (`@ai-sdk/anthropic`)? Claude is what users get via MCP — matching the model may matter for parity.
- [ ] **Feature flag**: Gate behind a feature flag / plan tier, or ship to everyone?
- [ ] **MCP coexistence**: Should we display MCP conversations in the same thread history, or keep them separate? (Recommendation: separate — different surfaces, different use cases.)

## Phasing

### Phase 1: Foundation
Migration, server service, meta-tools, streaming, basic panel, browsing context, PostHog events.

### Phase 2: Polish
Thread list/history, message queuing, context window pruning, token usage display, model selector, stream cancellation, Cmd+J hotkey.

### Phase 3: Monitoring
LLM-as-judge quality grading, admin dashboard (usage, costs, quality scores), tool success rate tracking.

### Phase 4: Enhancement
File uploads, record reference links, agent-driven navigation, per-company custom instructions, suggested prompts.

## Changelog

- 2026-07-01: Created
