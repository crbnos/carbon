# How Twenty Does Their In-App Agent — And What Carbon Should Steal

## The Problem Twenty Solved (That We Haven't)

Twenty built an in-app AI agent that's actually good. It can CRUD any record, search the web, run code, manage workflows, navigate the UI — the full CRM toolbox — with streaming responses, tool-call visibility, cost tracking, quality monitoring, and context awareness of what the user is currently looking at. And it does it without shipping hundreds of tool schemas in every system prompt.

We tried this before and it was trash. We moved to MCP + Claude because Claude is better at reasoning, and MCP lets the model discover tools dynamically. The problem: **zero visibility** into how people use it. No telemetry, no conversation persistence, no cost tracking, no quality scoring.

Twenty solves every one of these problems. Here's how.

---

## Architecture Overview

```
┌─ Frontend (React) ─────────────────────────────────────────┐
│                                                             │
│  Side Panel (right drawer)                                  │
│  ├── Thread list (grouped by date, archive/rename/delete)   │
│  ├── Chat view (messages + streaming + tool steps)          │
│  │   ├── Message renderer (text, tools, reasoning, files)   │
│  │   ├── Tool step renderer (expandable, Input/Output tabs) │
│  │   └── Context usage ring (token %, cost breakdown)       │
│  └── Editor (TipTap, file upload, model selector)           │
│                                                             │
│  Context: browsingContext = what page/record user is viewing │
│  State: Jotai atoms, scoped per thread                      │
│  Transport: GraphQL subscription over SSE                   │
│                                                             │
└─────────────────┬───────────────────────────────────────────┘
                  │ GraphQL mutations + SSE subscription
                  ▼
┌─ Backend (NestJS) ──────────────────────────────────────────┐
│                                                             │
│  AgentChatResolver                                          │
│  ├── sendChatMessage() → queue or stream                    │
│  ├── stopAgentChatStream() → Redis cancel pub/sub           │
│  └── onAgentChatEvent subscription (filtered by threadId)   │
│                                                             │
│  AgentChatStreamingService                                  │
│  ├── Save user message to DB                                │
│  ├── Load full history from DB                              │
│  ├── Enqueue StreamAgentChatJob on BullMQ                   │
│  └── Set thread.activeStreamId                              │
│                                                             │
│  StreamAgentChatJob (background worker)                     │
│  ├── ChatExecutionService.streamChat()                      │
│  │   ├── Build actor context (user, role, permissions)      │
│  │   ├── Build tool catalog index (N tools)                 │
│  │   ├── Pre-load common tools + bind native model tools    │
│  │   ├── Register meta-tools: learn_tools, execute_tool,    │
│  │   │   load_skills                                        │
│  │   ├── Build system prompt (sections)                     │
│  │   ├── Inject browsing context into last user message     │
│  │   ├── Prune if over 90% context window                   │
│  │   └── streamText() via Vercel AI SDK                     │
│  ├── Publish chunks → Redis → GraphQL subscription          │
│  ├── On finish: persist assistant message to DB             │
│  ├── Update thread token counters                           │
│  ├── Bill usage (per-step credit decrement)                 │
│  ├── Record metrics (TTFT, latency, tool success/fail)      │
│  └── Flush next queued message if any                       │
│                                                             │
│  Tool System                                                │
│  ├── ToolRegistryService (central registry)                 │
│  ├── 9 ToolProvider categories (CRUD, Action, Workflow...)   │
│  ├── learn_tools — discover schema on demand                │
│  ├── execute_tool — invoke by name                          │
│  ├── load_skills — load knowledge docs on demand            │
│  └── Role-scoped: user's role → available tools             │
│                                                             │
│  Monitoring                                                 │
│  ├── AgentTurnGraderService (LLM-as-judge, 0-100 score)    │
│  ├── AgentTurnEvaluationEntity (persisted per turn)         │
│  ├── OpenTelemetry metrics (13+ counters/histograms)        │
│  └── Billing: per-step credit tracking + exhaustion stop    │
│                                                             │
│  Data Model (Postgres, workspace-scoped)                    │
│  ├── AgentEntity (config: prompt, model, tools, role)       │
│  ├── AgentChatThreadEntity (conversation, token tracking)   │
│  ├── AgentTurnEntity (one request-response cycle)           │
│  ├── AgentMessageEntity (user or assistant message)         │
│  ├── AgentMessagePartEntity (text, tool call, file, etc.)   │
│  └── AgentTurnEvaluationEntity (quality scores)             │
│                                                             │
│  Redis                                                      │
│  ├── Stream chunk accumulation (catch-up on reconnect)      │
│  ├── Cancel pub/sub channel                                 │
│  └── Event publishing for GraphQL subscriptions             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## The 7 Things Twenty Does Right

### 1. The Meta-Tool Pattern (learn → execute)

**The problem:** A CRM has hundreds of tools (CRUD for every object, plus actions, workflows, metadata, views, etc.). You can't stuff all their schemas into the system prompt — it would blow the context window and confuse the model.

**Twenty's solution:** Three meta-tools:

| Meta-Tool | Purpose |
|---|---|
| `learn_tools` | Returns schemas/descriptions for named tools. The model calls this BEFORE executing. Accepts an array — batch discovery. |
| `execute_tool` | Executes a named tool with arguments. The model provides `{ toolName, arguments }`. All dynamic invocations go through this. |
| `load_skills` | Loads detailed knowledge documents (instructions, correct schemas, anti-patterns) that teach the model how to use complex tool domains. |

The system prompt contains only a **catalog** — tool names grouped by category — not schemas. The model discovers schemas on demand.

A few high-frequency tools (search, common CRUD) are **pre-loaded** (schema in the system prompt, callable directly). Everything else goes through learn → execute.

**Why this matters for Carbon:** This is the exact pattern that makes an in-app agent competitive with Claude + MCP. MCP does dynamic tool discovery too — that's why it works. Twenty just does it in-process instead of over a protocol.

### 2. Every Turn is Persisted with Full Fidelity

**Data model:**
```
Thread → Turn → Message → MessagePart[]
```

Every tool call, every tool result, every text fragment, every reasoning step, every file attachment, every error — persisted as an ordered `AgentMessagePartEntity` with:

- `type` — text, reasoning, tool-invocation, file, source-url, source-document, step-start
- `toolName`, `toolCallId`, `toolInput` (jsonb), `toolOutput` (jsonb)
- `state` — input-streaming, input-available, output-available, output-error
- `providerExecuted` — true for server-side tools (e.g., Anthropic web_search)
- `errorMessage`, `errorDetails`
- `fileId` → FileEntity (for uploads and generated files)
- `providerMetadata` (jsonb) — raw provider extras

**Why this matters:** This is the visibility we're missing. With full persistence:
- You can replay any conversation
- You can see exactly which tools were called, with what args, and what they returned
- You can audit costs per turn
- You can grade quality (see #5)
- You can debug failures

### 3. Streaming via Job Queue + Redis + GraphQL Subscriptions

**The flow:**
1. User sends message → GraphQL mutation saves it and enqueues a background job
2. Background job calls `streamText()` (Vercel AI SDK)
3. Each chunk published to Redis list + Redis pub/sub
4. GraphQL subscription (over SSE) delivers chunks to frontend
5. On completion: persist assistant message, update token counters, flush queued messages

**Key details:**
- **Thread-level locking**: `activeStreamId` on the thread prevents concurrent streams. Additional messages during a stream are **queued** (status: QUEUED) and flushed sequentially.
- **Catch-up**: Chunks accumulate in a Redis list (1h TTL). If the client reconnects, `chatStreamCatchupChunks` returns everything since the last persisted message.
- **Cancellation**: `stopAgentChatStream` publishes to a Redis cancel channel → AbortController.abort() on the worker.
- **Keep-alive**: The subscription resolver sends heartbeat events; the client detects stale connections and resubscribes.

**Why this matters:** Running inference in a background job (not inline in the HTTP handler) is correct. It decouples the user's connection from the LLM call, allows clean cancellation, and enables message queuing.

### 4. Browsing Context — The Agent Knows What You're Looking At

When you send a message, the frontend gathers `browsingContext`:

```typescript
type BrowsingContext =
  | { type: 'recordPage'; objectNameSingular: string; recordId: string; ... }
  | { type: 'listView'; objectNameSingular: string; viewId: string; viewName: string; filterDescriptions: string[] };
```

This is injected into the last user message as a `<browsing_context>` XML block. The system prompt tells the model to use it only when the user explicitly asks about the current page.

Context is **diffed** — only sent when it changes between messages. This avoids bloating every turn with identical context.

**Why this matters for Carbon:** A manufacturing ERP agent that knows you're looking at a specific work order, BOM, or quality check is dramatically more useful than one that starts from scratch every message.

### 5. LLM-as-Judge Quality Monitoring

**AgentTurnGraderService** runs an LLM evaluation on completed turns:

1. Loads the turn's messages and parts
2. Builds evaluation context (user request, assistant response, tools used, errors)
3. Calls a fast model with a grading prompt:
   - Task Completion (did it do what was asked?)
   - Tool Usage (correct and appropriate?)
   - Response Quality (clear, accurate, helpful?)
   - Error Handling (graceful?)
4. Returns a 0–100 score + comment
5. Falls back to heuristic if LLM eval fails (-30 per error, -50 if no response)

Evaluations are stored as `AgentTurnEvaluationEntity` and queryable via GraphQL.

There's also `RunEvaluationInputJob` — run test inputs against agents and auto-grade them. Useful for prompt iteration.

**Why this matters:** This is how you know if the agent is actually good. Without this, you're guessing.

### 6. Comprehensive Metrics and Billing

**13+ OpenTelemetry metrics:**
- `ai-chat/input-tokens`, `output-tokens`, `cache-read-tokens`, `cache-write-tokens`
- `ai-chat/ttft-ms` (time to first token)
- `ai-chat/turn-latency-ms`, `step-latency-ms`
- `ai-chat/tool-execution-succeeded`, `tool-execution-failed` (per tool, per model)
- `ai-chat/tool-output-tokens` (histogram — tracks output sizes)
- `ai-chat/tool-learned-succeeded`, `tool-learned-failed`
- `ai-chat/skill-loaded-succeeded`, `skill-loaded-failed`

**Per-thread billing:**
- `totalInputTokens`, `totalOutputTokens`, `totalInputCredits`, `totalOutputCredits`
- `totalCacheReadTokens`, `totalCacheCreationTokens`
- `conversationSize` (current context length), `contextWindowTokens`
- Credits decremented per-step with graceful stop on exhaustion

**Frontend token display:**
- Context usage ring (blue → orange → red)
- Hover card with per-message and conversation-level cost breakdowns

### 7. Context Window Management

**MessagePruningService** kicks in at 90% of the model's context window:
- Removes reasoning except in the last message
- Removes tool calls except in the last 2 messages
- Removes empty messages
- Sends a `data-compaction` event to the UI (user sees "conversation has been compacted")
- If still over limit after pruning → error telling user to start a new thread

---

## Carbon Architecture Proposal

Based on Twenty's patterns, here's what I'd build for Carbon:

### What We Keep
- **Claude as the model** — Twenty is model-agnostic (Vercel AI SDK), but Claude is our best performer
- **MCP server as the tool surface** — our existing tools work; we just need to wrap them

### What We Add

#### 1. Server-Side Chat Service
A NestJS (or equivalent) service that:
- Manages threads and messages in Postgres (or Supabase)
- Runs inference in a background job (not inline)
- Streams via SSE/WebSocket to the frontend
- Persists every turn with full tool call fidelity

#### 2. Meta-Tool Layer Over MCP
Instead of exposing all MCP tools directly to the model:
- **Tool catalog** in the system prompt (names + categories only)
- `learn_tools` → calls MCP `tools/list` filtered by name, returns schemas
- `execute_tool` → calls MCP `tools/call` with name + args
- Pre-load the 5-10 most-used tools directly

This gives us MCP compatibility while keeping the context window manageable.

#### 3. Browsing Context
The frontend sends the current route/record context with each message:
- Work order page → `{ type: 'workOrder', id: '...', partNumber: '...', operation: '...' }`
- BOM view → `{ type: 'bom', partId: '...', revision: '...' }`
- Quality check → `{ type: 'qualityCheck', id: '...', inspectionType: '...' }`

#### 4. Telemetry & Monitoring
- Per-turn persistence (user message, assistant response, tool calls, tool results, errors)
- Token usage tracking per thread
- LLM-as-judge quality scoring (async, background job)
- OpenTelemetry metrics: TTFT, turn latency, tool success/fail rates

#### 5. Context Window Pruning
- Track `conversationSize` per thread
- Prune at 90% of context window (remove old reasoning, old tool calls)
- Notify user on compaction

### What We Don't Need (Yet)
- Multi-agent routing (Twenty has one standard agent + custom agents; we just need one good one)
- Skills system (our MCP tools are already well-scoped)
- Billing/credits (internal tool, not a SaaS product)
- Code interpreter (not relevant for manufacturing ERP)

---

## Key Takeaway

The delta between "Claude + MCP server" and "good in-app agent" is mostly **infrastructure**, not AI:

1. **Persistence** — store every turn, every tool call, every result
2. **Streaming** — background job + SSE, not inline HTTP
3. **Tool discovery** — meta-tool pattern, not schema dump
4. **Context** — tell the model what the user is looking at
5. **Monitoring** — LLM-as-judge + metrics
6. **Pruning** — manage the context window explicitly

Twenty built all of this on NestJS + Postgres + Redis + Vercel AI SDK. We can build it on our stack (React Router + Supabase + whatever queue/pub-sub we choose). The patterns transfer cleanly.

The hardest part isn't any single piece — it's wiring them together into a system that feels responsive, persists everything, and gives us visibility into what's happening. Twenty did it well. We should steal liberally.
