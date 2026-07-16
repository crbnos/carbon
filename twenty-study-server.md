# Twenty CRM — Server-Side AI Agent Architecture

Deep study of the AI agent system in `packages/twenty-server/src/engine/metadata-modules/ai/` and `packages/twenty-server/src/modules/workflow/workflow-executor/workflow-actions/ai-agent/`.

---

## 1. Data Model

### Entity Relationship Diagram (Conceptual)

```
AgentEntity (workspace-scoped, "agent" table)
  ├── AgentChatThreadEntity (1:N) — via agentId on turns
  └── RoleTargetEntity (1:1) — via agentId foreign key

AgentChatThreadEntity (core schema, "agentChatThread")
  ├── AgentTurnEntity (1:N)
  └── AgentMessageEntity (1:N)

AgentTurnEntity (core schema, "agentTurn")
  ├── AgentMessageEntity (1:N) — user + assistant messages in the turn
  └── AgentTurnEvaluationEntity (1:N) — monitoring grades

AgentMessageEntity (core schema, "agentMessage")
  └── AgentMessagePartEntity (1:N) — ordered parts (text, tool calls, files, sources, reasoning)
```

### AgentEntity (the agent definition)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | varchar | Unique per workspace (with deletedAt IS NULL constraint) |
| `label` | varchar | Display name |
| `icon` | varchar? | |
| `description` | text? | |
| `prompt` | text | System prompt / instructions for the agent |
| `modelId` | varchar | Defaults to `AUTO_SELECT_SMART_MODEL_ID` |
| `responseFormat` | jsonb | `{ type: 'text' }` or `{ type: 'json', schema: {...} }` |
| `isCustom` | boolean | false = system-created agent, true = user-created |
| `modelConfiguration` | jsonb? | `{ webSearch?: { enabled: boolean }, twitterSearch?: { enabled: boolean } }` |
| `evaluationInputs` | text[] | Pre-defined test inputs for the monitoring system |
| `workspaceId` | varchar | (from SyncableEntity) |
| `applicationId` | varchar | (from SyncableEntity — links to an Application) |
| `createdAt/updatedAt/deletedAt` | timestamptz | Soft-delete pattern |

**Key relationships:**
- An agent can be linked to a **Role** via a `RoleTargetEntity` (the `roleId`). This role scopes what tools the agent can access.
- Agents belong to an Application (Twenty's extensibility primitive).

### AgentChatThreadEntity (a chat conversation)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `workspaceId` | uuid FK | |
| `userWorkspaceId` | uuid FK | Owner of the thread (UserWorkspaceEntity) |
| `title` | varchar? | Auto-generated from first message, editable |
| `totalInputTokens` | int | Accumulated token usage |
| `totalOutputTokens` | int | |
| `totalInputCredits` | bigint | Billing credits (micro-units) |
| `totalOutputCredits` | bigint | |
| `totalCacheReadTokens` | bigint | |
| `totalCacheCreationTokens` | bigint | |
| `contextWindowTokens` | int? | Model's context window size |
| `conversationSize` | int | Estimated current context size in tokens |
| `activeStreamId` | varchar? | Non-null = a stream is currently in-flight |
| `deletedAt` | timestamptz? | Soft-delete (archive/unarchive) |

### AgentTurnEntity (one request-response cycle)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `workspaceId` | uuid FK | |
| `threadId` | uuid FK → AgentChatThreadEntity | |
| `agentId` | uuid? | Which agent handled this turn (null for user-only turns) |
| `messages` | 1:N → AgentMessageEntity | |
| `evaluations` | 1:N → AgentTurnEvaluationEntity | |
| `createdAt` | timestamptz | |

A **turn** groups a user message and its corresponding assistant response(s). Each turn can be independently evaluated by the monitoring system.

### AgentMessageEntity (a single message in a turn)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `workspaceId` | uuid FK | |
| `threadId` | uuid FK | |
| `turnId` | uuid? FK | |
| `agentId` | uuid? | |
| `role` | enum | `'system'` \| `'user'` \| `'assistant'` |
| `status` | enum | `'queued'` \| `'sent'` — supports message queuing when a stream is active |
| `parts` | 1:N → AgentMessagePartEntity | |
| `processedAt` | timestamptz? | |
| `createdAt` | timestamptz | |

### AgentMessagePartEntity (one content block within a message)

This is the most structurally rich entity — it captures every possible content type in a single polymorphic table:

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `messageId` | uuid FK | |
| `orderIndex` | int | Display order within the message |
| `type` | varchar | `'text'` \| `'reasoning'` \| `'file'` \| `'tool-invocation'` \| `'source-url'` \| `'source-document'` \| `'step-start'` \| `'data-routing-status'` |
| `textContent` | text? | For text parts |
| `reasoningContent` | text? | For reasoning/thinking parts |
| `toolName` | varchar? | For tool invocations |
| `toolCallId` | varchar? | LLM-generated tool call ID |
| `toolInput` | jsonb? | Arguments passed to the tool |
| `toolOutput` | jsonb? | Result returned by the tool |
| `state` | varchar? | Tool state: `'input-streaming'`, `'input-available'`, `'output-available'`, `'output-error'` |
| `providerExecuted` | boolean? | True for server-side tools (e.g., Anthropic web_search) |
| `errorMessage` | text? | Error text if the tool failed |
| `errorDetails` | jsonb? | Structured error details |
| `sourceUrl*` | varchar? | For web search source citations |
| `sourceDocument*` | varchar? | For document source citations |
| `fileId` | uuid? FK → FileEntity | For file attachments |
| `fileFilename` | varchar? | |
| `providerMetadata` | jsonb? | Provider-specific metadata (e.g., Anthropic citations) |

### AgentTurnEvaluationEntity (monitoring grades)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `turnId` | uuid FK → AgentTurnEntity | |
| `score` | int | 0–100 quality score |
| `comment` | text? | Evaluation explanation |

---

## 2. Execution Model

There are **two distinct execution paths**: interactive chat and workflow (headless) execution.

### Path A: Interactive Chat (User-Facing)

```
User sends message via GraphQL
  └─ AgentChatResolver.sendChatMessage()
      ├─ Checks: model available? credits available? thread exists?
      ├─ If thread has activeStreamId → queue the message (AgentMessageStatus.QUEUED)
      └─ Otherwise:
          └─ AgentChatStreamingService.streamAgentChat()
              ├─ Saves user message to DB (addMessage)
              ├─ Loads full message history from DB (loadMessagesFromDB)
              ├─ Generates a streamId
              ├─ Enqueues StreamAgentChatJob to MessageQueue.aiStreamQueue
              └─ Sets thread.activeStreamId = streamId
                  └─ StreamAgentChatJob.handle()
                      ├─ Sets up AbortController (cancel via Redis pub/sub)
                      ├─ ChatExecutionService.streamChat()
                      │   ├─ Builds actor context (user identity, role, permissions)
                      │   ├─ Builds tool catalog index (all available tools)
                      │   ├─ Resolves AI model (auto-select or explicit)
                      │   ├─ Binds native tools (web search, twitter search)
                      │   ├─ Creates meta-tools: learn_tools, execute_tool, load_skills
                      │   ├─ Builds system prompt (base + response format + workspace instructions + user context + tool catalog + skill catalog)
                      │   ├─ Replaces unsupported file parts for the model
                      │   ├─ Injects browsing context into last user message
                      │   ├─ Prunes messages if over context window (MessagePruningService)
                      │   ├─ Calls Vercel AI SDK streamText()
                      │   └─ Returns the stream + model config
                      ├─ createUIMessageStream() wraps the stream
                      ├─ Publishes each chunk via Redis → GraphQL subscription
                      ├─ On finish: persists assistant message to DB
                      ├─ Updates thread token usage counters
                      └─ Flushes next queued message if any
```

### Path B: Workflow Agent Execution (Headless)

```
Workflow engine triggers AiAgentWorkflowAction.execute()
  └─ Loads agent from DB
      └─ AgentAsyncExecutorService.executeAgent()
          ├─ Checks billing credits
          ├─ Resolves model
          ├─ Gets agent's role → scopes tool access
          ├─ Gets registry tools (DATABASE_CRUD + ACTION categories only)
          ├─ Binds native tools (web search, twitter search per agent config)
          ├─ Calls Vercel AI SDK generateText() (NOT streaming)
          │   ├─ system prompt = WORKFLOW_SYSTEM_PROMPTS.BASE + agent.prompt
          │   ├─ tools = registry tools + native tools
          │   ├─ stopWhen: MAX_STEPS (300) or out of credits
          │   ├─ onStepFinish: decrement credits, record metrics
          │   └─ experimental_repairToolCall: auto-fix malformed tool calls
          ├─ If agent has JSON responseFormat:
          │   └─ Second generateText() call to structure output via OUTPUT_GENERATOR prompt
          └─ Returns AgentExecutionResult { result, usage, steps, modelId, cost }
```

### Also: Direct Agent Run (GraphQL API)

The `AgentRunResolver.runAgent()` mutation exposes headless agent execution via GraphQL (for external API consumers). It delegates to `AgentRunService` → `AgentAsyncExecutorService`.

---

## 3. Tool / Function Calling Architecture

Twenty uses a sophisticated **two-tier tool system**:

### Tier 1: Pre-loaded (Direct) Tools
These are available in the ToolSet passed directly to `streamText`/`generateText`. The model can call them natively via function calling.

- **Pre-loaded registry tools**: A subset of common tools loaded eagerly (defined in `AI_CHAT_TOOL_NAMES_TO_PRELOAD`)
- **Native model tools**: SDK-level tools like Anthropic's server-side `web_search` or Twitter search. Bound via `NativeToolBinderService.bind()`.

### Tier 2: Discoverable (Meta-Tool) Tools
The vast majority of tools are accessed through three meta-tools:

1. **`learn_tools`** — Returns schemas/descriptions for named tools. The model calls this to discover tool parameters before execution. Accepts an array of tool names. Backed by `ToolRegistryService.getToolInfo()`.

2. **`execute_tool`** — Executes a named tool with arguments. The model provides `{ toolName, arguments }`. Backed by `ToolRegistryService.resolveAndExecute()`. All dynamic tool invocations route through this — there is no fast path for preloaded tools via execute_tool.

3. **`load_skills`** — Loads detailed skill documentation (instructions, schemas, patterns) that teach the model how to use complex tool domains. Skills are separate from tools — they're knowledge, not execution capability.

### Tool Categories
```typescript
ToolCategory.DATABASE_CRUD     // find_many_*, find_one_*, create_one_*, etc.
ToolCategory.ACTION            // http_request, email, etc.
ToolCategory.WORKFLOW          // workflow management
ToolCategory.METADATA          // schema management
ToolCategory.VIEW              // view/filter/sort management
ToolCategory.DASHBOARD         // dashboard management
ToolCategory.LOGIC_FUNCTION    // custom serverless functions
ToolCategory.NAVIGATION_MENU_ITEM  // sidebar/favorites
ToolCategory.WEBHOOK           // outgoing webhooks
```

**Workflow agents** only get `DATABASE_CRUD` + `ACTION` categories (to prevent recursive workflow execution).

**Chat agents** get all categories plus meta-tools.

### Tool Permission Scoping
- **Workflow agents**: Tools are scoped by the agent's assigned **Role** (`RoleTargetEntity`). No role = no registry tools.
- **Chat agents**: Tools are scoped by the **user's role** (the human chatting). The `AgentActorContextService` builds the actor context from the user's workspace membership.

### Tool Call Repair
Twenty implements `experimental_repairToolCall` which catches tool validation errors, then uses a second `generateText()` call to auto-fix malformed tool inputs (e.g., wrong enum values, incorrect structures). It does NOT attempt to repair `NoSuchToolError` (invalid tool names).

### Tool Output → DB Persistence
Tool invocations are persisted as `AgentMessagePartEntity` records with:
- `type`: the tool part type
- `toolName`: the tool that was called
- `toolCallId`: the LLM-generated correlation ID
- `toolInput`: arguments (jsonb)
- `toolOutput`: result (jsonb)
- `state`: execution state
- `providerExecuted`: true for server-side tools
- `errorMessage`/`errorDetails`: if the tool failed

---

## 4. Streaming Architecture

### Chat Streaming Flow

1. **Job queue**: `sendChatMessage` enqueues a `StreamAgentChatJob` on `MessageQueue.aiStreamQueue` (scoped to `Scope.REQUEST` for dependency injection).

2. **Vercel AI SDK `streamText()`**: The core streaming call. Returns an async iterable of chunks.

3. **UI Message Stream**: `createUIMessageStream()` wraps the SDK stream into a UI-friendly format with metadata computed at each step (token usage, cost breakdowns, conversation size).

4. **Redis pub/sub for delivery**: Each chunk is published via `AgentChatEventPublisherService`:
   - Chunks are appended to a Redis list (`agent-chat-stream-chunks:{threadId}`) with TTL of 1 hour
   - Each chunk gets a sequence number (from RPUSH return value)
   - Published via `SubscriptionService.publishToAgentChat()` → GraphQL subscription

5. **GraphQL Subscription**: `AgentChatSubscriptionResolver.onAgentChatEvent()` exposes a subscription filtered by `threadId`. Includes keepalive heartbeats at a configurable interval.

6. **Catch-up mechanism**: If a client reconnects mid-stream, `chatStreamCatchupChunks` query returns all accumulated chunks from the Redis list plus the max sequence number.

### Event Types Published
```typescript
type AgentChatSubscriptionEvent =
  | { type: 'stream-chunk'; chunk: Record<string, unknown>; seq?: number }
  | { type: 'message-persisted'; messageId: string }
  | { type: 'stream-error'; code: string; message: string }
  | { type: 'credits-exhausted' }
  | { type: 'queue-updated' }           // new queued message added/removed
  | { type: 'keepalive' }
  | { type: 'data-code-execution'; ... }
  | { type: 'data-compaction'; ... }     // messages were pruned
  | { type: 'data-thread-title'; ... }   // title auto-generated
```

### Stream Cancellation
- User calls `stopAgentChatStream` mutation
- Publishes "cancel" to Redis channel `agent-chat:cancel:{threadId}`
- `AgentChatCancelSubscriberService` (a single shared Redis subscriber connection per process) triggers `AbortController.abort()`
- The abort signal propagates to the Vercel AI SDK `streamText()` call
- On abort, usage events are still emitted; the assistant message (if it has text) is still persisted

### Message Queuing (Concurrent Messages)
When a stream is already active on a thread (`activeStreamId` is set):
- New messages are saved with `status: QUEUED`
- When the active stream finishes, `flushNextQueuedMessage()` promotes the next queued message and starts a new stream
- Queued messages can be deleted by the user

---

## 5. Multi-Turn Conversation Management

### Message Persistence
Every message (user and assistant) is persisted to the DB as `AgentMessageEntity` + `AgentMessagePartEntity` records. The conversation history is the source of truth.

### Loading History for LLM Calls
```
loadMessagesFromDB() →
  filter out QUEUED messages →
  sort by processedAt ASC →
  mapDBPartsToUIMessageParts() →
  sign file URLs →
  return UIMessage[]
```

The mapping layer (`mapDBPartToUIMessagePart` / `mapUIMessagePartsToDBParts`) converts between:
- **DB format**: Flat columns (textContent, toolName, toolInput, etc.)
- **UI format**: Vercel AI SDK `UIMessagePart` types (text, tool-invocation, file, source-url, etc.)

### Dangling Tool Part Handling
Before passing messages to the LLM, `finalizeDanglingToolParts()` ensures clean state:
- `input-streaming` parts (incomplete) → filtered out entirely
- `input-available` parts (interrupted mid-flight) → converted to `output-error` with "Tool execution was interrupted"
- `output-error` with null input → patched with `{}` to prevent provider rejection (Anthropic requires input on all tool_use blocks)

### Context Window Management
`MessagePruningService.pruneIfOverContextWindowLimit()`:
- Threshold: 90% of model's context window
- Uses Vercel AI SDK's `pruneMessages()` with:
  - Reasoning removed except in the last message
  - Tool calls removed except in the last 2 messages
  - Empty messages removed
- If pruned, a `data-compaction` event is sent to the client
- If still over limit after pruning → throws error telling user to start a new thread

### Thread Usage Tracking
After each stream finishes, the thread's token counters are updated atomically:
- `totalInputTokens += streamUsage.inputTokens`
- `totalOutputTokens += streamUsage.outputTokens`
- `totalInputCredits += streamUsage.inputCredits`
- `totalOutputCredits += streamUsage.outputCredits`
- `conversationSize` = last step's input token count (tracks growing context)
- `contextWindowTokens` = model's context window

### Browsing Context
When the user is viewing a specific page in Twenty, the client sends a `browsingContext` object:
- **Record page**: `{ type: 'recordPage', objectNameSingular, recordId, pageLayoutId?, activeTabId? }` — injected as a note telling the agent what record is being viewed
- **List view**: `{ type: 'listView', objectNameSingular, viewId, viewName, filterDescriptions[] }` — includes current filters

This is appended to the last user message's parts as a `<browsing_context>` XML block, with an instruction to only use it when relevant.

---

## 6. Agent Configuration

### System Prompts

**Chat agents** get a rich multi-section prompt built by `SystemPromptBuilderService.buildFullPrompt()`:
1. **Base instructions** (`CHAT_SYSTEM_PROMPTS.BASE`) — CRM context, Plan→Skill→Learn→Execute workflow, database vs HTTP tool guidance, data efficiency rules
2. **Browsing context instruction** — hint about `<browsing_context>` tags
3. **Response format** — markdown formatting, record reference syntax `[[record:objectName:recordId:displayName]]`
4. **Workspace instructions** — admin-configured custom instructions (`workspace.aiAdditionalInstructions`)
5. **User context** — first/last name, locale, timezone
6. **Tool catalog** — categorized list of all available tools with preloaded indicators
7. **Skill catalog** — list of loadable skills
8. **Uploaded files** — code interpreter file references

**Workflow agents** get a simpler prompt:
1. `WORKFLOW_SYSTEM_PROMPTS.BASE` — batch tool preference, persistence, role-scoped permissions
2. Agent's custom `prompt` field
3. If JSON output needed: `WORKFLOW_SYSTEM_PROMPTS.OUTPUT_GENERATOR` for a second pass

### Model Configuration

- `modelId`: Can be a specific model ID or `AUTO_SELECT_SMART_MODEL_ID` / `AUTO_SELECT_FAST_MODEL_ID`
- `modelConfiguration.webSearch.enabled`: Enables native web search (Anthropic server-side)
- `modelConfiguration.twitterSearch.enabled`: Enables native Twitter/X search
- Reasoning budget: `AGENT_CONFIG.REASONING_BUDGET_TOKENS = 12000`
- Max steps: `AGENT_CONFIG.MAX_STEPS = 300`

### Response Format

```typescript
type AgentResponseFormat =
  | { type: 'text' }
  | { type: 'json'; schema: JSONSchema7 }
```

When `type: 'json'`, the workflow agent does a two-pass execution:
1. First `generateText()` with tools to gather information
2. Second `generateText()` with `Output.object({ schema })` to structure the result

### Role-Based Access Control

Agents can be assigned a **Role** via `AiAgentRoleService`:
- `assignRoleToAgent({ agentId, roleId })` — creates a `RoleTargetEntity` linking agent to role
- The role must have `canBeAssignedToAgents: true`
- The role's permissions scope which tools the agent can access
- For workflow agents: no role = no registry tools (only native tools)
- For chat agents: the user's role is used (not the agent's)

---

## 7. Monitoring / Observability

### ai-agent-monitor Module

The monitoring system provides **automated quality evaluation** of agent turns.

#### AgentTurnEvaluationEntity
Stores a 0–100 score and optional comment per turn.

#### AgentTurnGraderService.evaluateTurn()
Uses AI to grade a completed turn:
1. Loads the turn with all messages and parts
2. Builds evaluation context (user request text, assistant response text, tools used, errors)
3. Calls `generateText()` with the default speed model
4. Evaluates on 4 criteria:
   - **Task Completion**: Did the agent accomplish the user's request?
   - **Tool Usage**: Were tools used correctly?
   - **Response Quality**: Clear, accurate, helpful?
   - **Error Handling**: Graceful error recovery?
5. Returns `{ score: 0-100, comment: string }`
6. Falls back to a heuristic if AI evaluation fails:
   - Starts at 100
   - -30 per error
   - -50 if no text response
   
#### EvaluateAgentTurnJob
A queued job (on `MessageQueue.aiQueue`) that runs evaluation asynchronously.

#### RunEvaluationInputJob
Allows running **test inputs** against an agent:
1. Creates a thread titled "Eval: {input}..."
2. Creates a turn for the agent
3. Executes the agent with the test input
4. Auto-evaluates the resulting turn

#### GraphQL API
- `agentTurns(agentId)` — lists all turns for an agent with evaluations
- `evaluateAgentTurn(turnId)` — triggers evaluation of a specific turn
- `runEvaluationInput(agentId, input)` — runs a test input and evaluates

### Metrics and Telemetry

Throughout the execution, detailed metrics are recorded via `MetricsService`:

**Chat metrics:**
- `AiChatInputTokens`, `AiChatOutputTokens`, `AiChatCacheReadTokens`, `AiChatCacheWriteTokens`
- `AiChatTtftMs` — Time to first token
- `AiChatTurnLatencyMs` — Total turn latency
- `AiChatStepLatencyMs` — Per-step latency
- `AiChatToolExecutionSucceeded/Failed` — per tool, per model
- `AiChatToolOutputTokens` — histogram of tool output sizes
- `AiChatToolLearnedSucceeded/Failed` — learn_tools success tracking
- `AiChatSkillLoadedSucceeded/Failed` — skill loading tracking

**Workflow metrics:**
- `WorkflowAgentToolExecutionSucceeded/Failed`
- `WorkflowAgentToolOutputTokens`

All LLM calls use `experimental_telemetry: AI_TELEMETRY_CONFIG` for OpenTelemetry integration.

### Billing / Usage Tracking

`AiBillingService` handles:
- Per-step credit decrement via `decrementAndCheckAvailableCredits()`
- Cost calculation per model (input/output/cache tokens + native web search costs)
- Credit exhaustion detection (stops the agent gracefully)
- Usage event emission for billing systems
- Native web search billing (separate per-call cost)

---

## 8. Flat Agent Cache Architecture

The `flat-agent` module provides an in-memory cache layer for agent definitions:

- `WorkspaceFlatAgentMapCacheService` computes and caches a `FlatAgentMaps` structure
- `WorkspaceFlatRoleTargetByAgentIdService` caches the agent→role mapping
- Both are invalidated when agents or role targets change
- Lookups by ID or universal identifier are O(1) from the cache
- Used by `AgentService` for all read operations (avoids DB queries on hot paths)

---

## 9. Key Design Decisions & Patterns

### 1. Vercel AI SDK as the core abstraction
Twenty uses `ai` (Vercel AI SDK) throughout: `streamText()`, `generateText()`, `convertToModelMessages()`, `pruneMessages()`, `createUIMessageStream()`, tool schemas via `jsonSchema()`, and `UIMessage`/`UIMessagePart` types. This gives them provider-agnostic model support.

### 2. Job queue for streaming
Chat streaming runs in a background job (`StreamAgentChatJob`) on `MessageQueue.aiStreamQueue`, not inline in the GraphQL resolver. This allows:
- Long-running streams without blocking the HTTP connection
- Reliable message delivery via Redis pub/sub + GraphQL subscriptions
- Catch-up for reconnecting clients (Redis list accumulation)
- Clean cancellation via AbortController

### 3. Meta-tool pattern for scalability
Rather than registering hundreds of tools directly (which would bloat the system prompt), Twenty uses 3 meta-tools (`learn_tools`, `execute_tool`, `load_skills`) and a tool catalog in the system prompt. The model discovers and invokes tools dynamically.

### 4. Two-pass structured output
For workflow agents needing JSON output, the system makes two LLM calls: first with tools to gather data, then without tools to structure the result according to a JSON schema. This separates "doing" from "formatting."

### 5. Workspace-scoped multi-tenancy
Every entity includes `workspaceId`. All repositories are workspace-scoped (`WorkspaceScopedRepository`). The cache layer is per-workspace. This ensures complete tenant isolation.

### 6. Credit-based billing with graceful degradation
The agent checks credits before execution and after each step. When credits run out, it sets a flag that triggers `stopWhen` on the next step, allowing a graceful stop rather than a hard crash.
