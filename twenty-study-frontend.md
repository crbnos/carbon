# Twenty CRM — Frontend AI Chat UI Study

## Executive Summary

Twenty's AI chat is a **side-panel experience** — not a full page or modal. It lives inside the CRM's collapsible right side panel alongside other views (record detail, workflow editor, email composer, etc.). The system uses **GraphQL subscriptions over SSE** for real-time streaming, a **Vercel AI SDK `readUIMessageStream`**-based streaming reader, **Jotai** for all state management, and **TipTap** for the rich-text editor input. It supports threads, file uploads, tool call display, code execution rendering, reasoning/thinking steps, record-reference linking, context-window usage tracking, and message queuing.

---

## 1. UI Architecture

### Side Panel Container

The AI chat occupies a page slot within `SidePanelRouter → SidePanelPagesConfig`:

```
SidePanelForDesktop
  └─ SidePanelRouter
       └─ SIDE_PANEL_PAGES_CONFIG (Map<SidePanelPages, ReactNode>)
            ├─ SidePanelPages.AskAI → <SidePanelAskAiPage> → <AiChatTab>
            └─ SidePanelPages.ViewPreviousAiChats → <SidePanelAiChatThreadsPage> → <AiChatThreadsList>
```

**Key design decisions:**
- The side panel slides in from the right edge. It's a **persistent drawer** that can be opened/closed, with animated width transitions.
- There's a **navigation stack** inside the side panel — you can navigate from thread list → individual chat → back, with a `SidePanelTopBar` providing back button and context chips.
- There's also a **navigation drawer** (`NavigationDrawerAiChatContent`) that shows chat threads in the left sidebar when the "AI" section is selected.

### The Chat Page: `AiChatTab`

The main chat page (`AiChatTab`) is composed of:

```
AiChatTab
├─ DropZone (file drag-and-drop overlay)
├─ AiChatTabMessageList
│   └─ ScrollWrapper
│       ├─ AiChatNonLastMessageIdsList (all messages except the last)
│       ├─ AiChatLastMessageWithStreamingState (last message, with streaming state)
│       ├─ AiChatErrorUnderMessageList
│       ├─ AgentChatScrollToBottomOnDisplayedThreadChangeLayoutEffect
│       └─ AgentChatScrollToBottomOnMountLayoutEffect
│   └─ AiChatScrollToBottomButton
├─ AiChatQueuedMessages (shows pending queued messages)
└─ AiChatEditorSection (input area)
```

### Thread List: `AiChatThreadsList`

Accessible via `SidePanelPages.ViewPreviousAiChats`:

```
AiChatThreadsList
├─ AiChatThreadGroup (grouped by date: Today, Yesterday, Last 7 Days, etc.)
│   └─ AiChatThreadListItem (individual thread with icon, title, actions menu)
├─ AiChatThreadFilterDropdown (filter: all, active, archived)
├─ "New chat" button (Cmd+Enter)
└─ AiChatThreadDeleteConfirmationModal
```

Thread items show rename-in-place (inline `TextInput`), context menus (archive, rename, delete), and sparkle icons.

---

## 2. Provider / Context Architecture

### `AgentChatProvider`

Wraps the entire application (not just the chat panel):

```
AgentChatProvider
└─ AgentChatProviderContent
    ├─ AgentChatComponentInstanceContext.Provider (instanceId: 'agentChatComponentInstance')
    ├─ AgentChatThreadInitializationEffect (fetches threads on mount)
    └─ AgentChatRuntimeEffects (conditionally mounts based on chat opened status)
         ├─ AgentChatMessagesFetchEffect (fetches persisted messages when thread changes)
         ├─ AgentChatStreamSubscriptionEffect (manages GraphQL SSE subscription)
         ├─ AgentChatStreamKeepAliveEffect (detects stale subscriptions, forces resubscribe)
         ├─ AgentChatSessionStartTimeEffect (tracks UI session start for tool call filtering)
         ├─ AgentChatStreamingPartsDiffSyncEffect (syncs streaming parts to atom state)
         └─ AgentChatStreamingAutoScrollEffect (auto-scrolls during streaming)
```

Important: Effects are **lazily mounted** — `AgentChatRuntimeEffects` only renders after the chat has been opened at least once (`hasAgentChatBeenOpenedState`).

### `AgentChatContext`

A React context exposing:
```typescript
{
  ensureThreadForDraft: (() => void) | undefined;
  threadsLoading: boolean;
  messagesLoading: boolean;
}
```

---

## 3. State Management (Jotai)

All state is managed via Jotai atoms with a custom "component family state" pattern that scopes atoms by `instanceId` + `familyKey`:

### Key Atoms (per-thread, scoped by `{ threadId }`):
- `agentChatMessagesComponentFamilyState` — the message array for the displayed thread
- `agentChatFetchedMessagesComponentFamilyState` — persisted messages from the DB
- `agentChatIsStreamingComponentFamilyState` — whether a stream is active
- `agentChatErrorComponentFamilyState` — current error
- `agentChatIsAwaitingPersistedRefetchComponentFamilyState` — waiting for DB after stream complete
- `agentChatUsageComponentFamilyState` — token usage (input/output/cached/credits)
- `agentChatQueuedMessagesComponentFamilyState` — queued messages waiting for processing
- `currentAiChatThreadTitleComponentFamilyState` — the thread title (updated by the LLM)

### Key Atoms (global):
- `currentAiChatThreadState` — currently selected thread ID
- `agentChatInputState` — current editor text
- `agentChatDraftsByThreadIdState` — drafts per-thread (persists editor content across thread switches)
- `agentChatSelectedFilesState` / `agentChatUploadedFilesState` — file uploads
- `agentChatUserSelectedModelState` — user-selected model
- `agentChatStreamLastEventTimestampState` — keep-alive tracking
- `agentChatStreamResubscribeNonceState` — forces resubscription on increment
- `hasAgentChatBeenOpenedState` — lazy initialization flag
- `agentChatDisplayedThreadState` — tracks which thread is visually rendered (for thread-switch detection)

### Selectors:
- `agentChatHasMessageComponentSelector` — boolean: any messages?
- `agentChatLastMessageIdComponentSelector` — ID of the last message
- `agentChatNonLastMessageIdsComponentSelector` — all message IDs except the last
- `agentChatVisibleThreadsSelector` — threads filtered by archive state
- `agentChatMessageComponentFamilySelector` — individual message by ID

---

## 4. Streaming Architecture

### Transport: GraphQL Subscription over SSE

The streaming uses **graphql-sse** via a shared `sseClient` (not WebSocket):

```graphql
subscription OnAgentChatEvent($threadId: UUID!) {
  onAgentChatEvent(threadId: $threadId) {
    threadId
    event  # JSON blob containing the event
  }
}
```

### Event Types

The `event` field is a typed `AgentChatSubscriptionEvent` with these types:

| Event Type | Purpose |
|---|---|
| `stream-chunk` | A `UIMessageChunk` from the Vercel AI SDK protocol |
| `message-persisted` | Stream complete — message saved to DB, trigger refetch |
| `queue-updated` | Message queue changed — trigger refetch |
| `keepalive` | Keep-alive ping (no-op) |
| `stream-error` | Error with `message` + `code` fields |
| `credits-exhausted` | Billing credits ran out |

### Streaming Pipeline

```
SSE Event
  → sseClient.subscribe() callback
    → handleEvent()
      → if stream-chunk:
          1. Create TransformStream bridge (first chunk only)
          2. Pipe through createMidStreamAdapter() (injects synthetic init chunks for reconnection)
          3. Writer.write(chunk)
          4. readUIMessageStream() async iterable
          5. scheduleAtomUpdate(message) — throttled at 100ms
          6. flushToAtom() — updates agentChatMessagesComponentFamilyState
      → if message-persisted:
          1. Close writer
          2. Set isAwaitingPersistedRefetch = true
          3. Dispatch AGENT_CHAT_REFETCH_MESSAGES_EVENT_NAME
      → if stream-error:
          1. Set error state
          2. Close writer, set isStreaming = false
      → if credits-exhausted:
          1. Update workspace billing state
          2. Set specific error code
          3. Refetch messages, close stream
```

### Mid-Stream Reconnection

`createMidStreamAdapter()` is a `TransformStream` that handles **reconnecting mid-stream** (e.g., after an SSE disconnect). It tracks which part IDs have been initialized and injects synthetic `start`, `start-step`, `text-start`, `reasoning-start`, and `tool-input-start` chunks as needed. This allows `readUIMessageStream` (from Vercel AI SDK) to properly process content chunks even without the original initialization sequence.

### Keep-Alive & Recovery

`AgentChatStreamKeepAliveEffect`:
- Polls every N ms (configured via `AGENT_CHAT_STREAM_LIVENESS_CHECK_INTERVAL_IN_MS`)
- If no event received within `AGENT_CHAT_STREAM_LIVENESS_TIMEOUT_IN_MS`, forces resubscription
- Also listens for `SSE_CLIENT_RECONNECTED_EVENT_NAME` to recover streaming state
- Recovery: increments `agentChatStreamResubscribeNonceState` → triggers effect cleanup/restart in `useAgentChatSubscription`

### Throttled UI Updates

Streaming messages are throttled at **100ms** (`THROTTLE_MS`). The `scheduleAtomUpdate` function stores the latest message and uses `setTimeout` to coalesce rapid updates. On stream end, a final `flushToAtom()` ensures nothing is dropped.

---

## 5. GraphQL Schema (Queries, Mutations, Subscriptions)

### Queries

**`GetChatThreads`**
```graphql
query GetChatThreads {
  chatThreads {
    id, title, totalInputTokens, totalOutputTokens,
    contextWindowTokens, conversationSize,
    totalInputCredits, totalOutputCredits,
    deletedAt, lastMessageAt, createdAt, updatedAt
  }
}
```

**`GetChatMessages`** — fetches both persisted messages and catch-up chunks:
```graphql
query GetChatMessages($threadId: UUID!) {
  chatMessages(threadId: $threadId) {
    id, threadId, turnId, role, status, createdAt
    parts {
      id, messageId, orderIndex, type,
      textContent, reasoningContent,
      toolName, toolCallId, toolInput, toolOutput,
      state, providerExecuted,
      errorMessage, errorDetails,
      sourceUrlSourceId, sourceUrlUrl, sourceUrlTitle,
      sourceDocumentSourceId, sourceDocumentMediaType, sourceDocumentTitle, sourceDocumentFilename,
      fileMediaType, fileFilename, fileUrl, fileId,
      providerMetadata, createdAt
    }
  }
  chatStreamCatchupChunks(threadId: $threadId) {
    chunks, maxSeq
  }
}
```

The `chatStreamCatchupChunks` field is critical for **stream recovery** — it returns chunks that were emitted since the last persisted message, allowing the client to catch up without losing context.

### Mutations

**`SendChatMessage`**
```graphql
mutation SendChatMessage(
  $threadId: UUID!, $text: String!, $messageId: UUID!,
  $browsingContext: JSON, $modelId: String,
  $fileAttachments: [FileAttachmentInput!]
) {
  sendChatMessage(...) { messageId, queued, streamId }
}
```

**`CreateChatThread`**
```graphql
mutation CreateChatThread {
  createChatThread { id, title, createdAt, updatedAt }
}
```

**`StopAgentChatStream`**
```graphql
mutation StopAgentChatStream($threadId: UUID!) {
  stopAgentChatStream(threadId: $threadId)
}
```

Also exists (from search results, not fully explored):
- `ArchiveChatThread` / `UnarchiveChatThread`
- `DeleteChatThread`
- `UpdateChatThread` (rename)
- `DeleteQueuedMessage`

### Subscription

```graphql
subscription OnAgentChatEvent($threadId: UUID!) {
  onAgentChatEvent(threadId: $threadId) {
    threadId, event
  }
}
```

---

## 6. Message Rendering

### Message Structure

Messages follow the Vercel AI SDK `ExtendedUIMessage` type:
```typescript
interface ExtendedUIMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: ExtendedUIMessagePart[];
  metadata?: {
    createdAt?: string;
    usage?: { inputTokens, outputTokens, cachedInputTokens, inputCredits, outputCredits, conversationSize };
    model?: { contextWindowTokens };
  };
  status: string;
}
```

### `AiChatMessage` Component

The main message component:
- **User messages**: Right-aligned, background-colored bubble, `font-weight: 500`
- **Assistant messages**: Left-aligned, full-width, transparent background
- Shows timestamp on hover (relative: "2 minutes ago")
- Shows copy button on hover
- Renders file previews for attached files

### `AiChatAssistantMessageRenderer`

Handles the complex rendering of assistant message parts:

```
AiChatAssistantMessageRenderer
├─ For 'text' parts → LazyMarkdownRenderer
├─ For 'data-routing-status' → RoutingStatusDisplay
├─ For 'data-compaction' → AiChatCompactionIndicator
├─ For 'data-code-execution' → CodeExecutionDisplay
├─ For tool parts (isToolUIPart) → ToolStepRenderer
├─ For grouped reasoning parts → ThinkingStepsDisplay
└─ If no parts and no error → InitialLoadingIndicator (animated dots)
```

Parts are **grouped**: contiguous reasoning + tool-call parts are merged into `ThinkingStepsDisplay` blocks.

### Last Message Separation

The architecture deliberately separates the **last message** from all others:
- `AiChatNonLastMessageIdsList` — renders all messages except the last
- `AiChatLastMessageWithStreamingState` — renders only the last message with streaming state and error handling

This ensures only the last message re-renders during streaming, keeping the list performant.

---

## 7. Tool Result Display

### `ToolStepRenderer`

Tool calls are displayed as **expandable rows**:

```
┌──────────────────────────────────────────────┐
│ 🔍 Searched the web for "CRM pricing"  web_search │ ▼ │
│                                                     │
│  ┌──────────────────────────────────────────┐       │
│  │ [Output] [Input]                          │       │
│  │ { "results": [...], "message": "Found…" }│       │
│  └──────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────┘
```

**States:**
1. **Loading** (no output yet): Shows tool icon + shimmering text (`<ShimmeringText>`) + tool name badge
2. **Complete with output**: Expandable with tabs for Output/Input, rendered as `<JsonTree>`
3. **Error**: Shows error text directly
4. **Code interpreter**: Special rendering via `CodeExecutionDisplay`

**Tool display messages** are generated by `getToolDisplayMessage()` which has specific handling for:
- `web_search` / `app_exa_web_search` → "Searching the web for X" / "Searched the web for X"
- `learn_tools` → "Learning toolA, toolB" / "Learned toolA, toolB"
- `load_skills` → "Loading skillA" / "Loaded skillA"
- `code_interpreter` → Uses model-generated labels or "Running code" / "Ran code"
- Others → categorized by `buildToolStatusMessageByCategory` using a tool index

### `CodeExecutionDisplay`

Full-featured code execution viewer:
- Header with status badge (Running/Completed/Failed)
- Collapsible **Code** section with Monaco-based `CodeEditor` (Python, read-only, 300px max)
- Collapsible **Output** section with `TerminalOutput` (stdout/stderr)
- Collapsible **Generated Files** section with grid of file cards (image preview for PNG/JPEG/GIF/WebP, download link)

### `ThinkingStepsDisplay`

Groups reasoning and tool-call parts into a collapsible "thinking" section:

- **While thinking**: Shows all steps inline with orbit loader animation
- **After complete**: Collapses into "N steps" summary button
- Each step shows: tool icon + display message + optional expandable JSON tree
- Reasoning text shown below the steps in a muted container
- Tool steps within thinking blocks have their own expandable Input/Output tabs

### Record References in Markdown

The `LazyMarkdownRenderer` supports inline CRM record references via a special syntax:
```
[[record:company:uuid-here:Acme Corp]]
```
These are parsed by `RECORD_REFERENCE_REGEX` and rendered as `<RecordLink>` components — clickable chips with avatars that navigate to the record's detail page.

---

## 8. User Interaction Model

### Starting a Chat

1. User opens the side panel (toggle button, keyboard shortcut, or nav drawer)
2. The `AskAI` page shows the `AiChatEmptyState` with `AiChatSuggestedPrompts`:
   - Pre-defined prompt suggestions like "Search contacts", "Create a task", etc.
   - Clicking a suggestion fills the editor
3. User types in the TipTap editor
4. **Draft auto-creates thread**: As soon as the user starts typing on a new chat, `dispatchAgentChatEnsureThreadForDraftEvent()` fires, creating a thread server-side eagerly
5. Pressing Enter sends the message (Shift+Enter for newline)

### Sending Messages

The `useAgentChat` hook handles the full send flow:

1. Read text from editor state
2. Validate: non-empty text, at least one model enabled, no files still uploading
3. Call `ensureThreadIdForSend()` to create thread if needed
4. Clear editor
5. Create optimistic user message with `v4()` UUID
6. Append to messages atom immediately
7. Execute `SEND_CHAT_MESSAGE` GraphQL mutation with:
   - `threadId`, `text`, `messageId`, `browsingContext`, `modelId`, `fileAttachments`
8. If mutation returns `queued: true`, remove the optimistic message (it'll come back via subscription)
9. Dispatch `AGENT_CHAT_REFETCH_MESSAGES_EVENT_NAME` to refresh from server
10. On error: restore the editor text, remove optimistic message, set error state

### Stopping a Stream

The stop button calls `STOP_AGENT_CHAT_STREAM` mutation with the `threadId`.

### Model Selection

A `<Select>` dropdown in the editor section allows choosing the AI model. The selected model is stored in `agentChatUserSelectedModelState` and passed as `modelId` to the send mutation.

### File Uploads

- Files can be dragged onto the chat (full `DropZone` overlay)
- Or attached via `AgentChatFileUploadButton`
- Upload state tracked in `agentChatSelectedFilesState` (uploading) / `agentChatUploadedFilesState` (ready)
- Uploaded files shown as preview chips above the editor in `AgentChatContextPreview`
- Sent as `fileAttachments: [{ id, filename }]` in the mutation

### Message Queuing

When the agent is busy (streaming a response), additional messages can be sent and are **queued**:
- Shown in `AiChatQueuedMessages` between the message list and editor
- Each queued message shows a text preview and an "X" button to delete
- Queued messages are processed server-side; `queue-updated` events trigger refetch

---

## 9. Context Awareness

### `BrowsingContext` Type

The chat knows what the user is currently viewing:

```typescript
type BrowsingContext =
  | {
      type: 'recordPage';
      objectNameSingular: string;   // e.g. 'company'
      recordId: string;
      pageLayoutId?: string;        // for tab context
      activeTabId?: string | null;  // which tab is selected
    }
  | {
      type: 'listView';
      objectNameSingular: string;
      viewId: string;
      viewName: string;
      filterDescriptions: string[];  // human-readable filter descriptions
    };
```

### How Context is Gathered

`useGetBrowsingContext()` reads from the **context store** (Jotai atoms scoped to `MAIN_CONTEXT_STORE_INSTANCE_ID`):

1. Gets the current page type (`Record` vs. table/kanban view)
2. Gets the object metadata item (which CRM object type)
3. For **record pages**: extracts the single selected record ID, plus optional page layout tab
4. For **list views**: extracts view ID, name, and all active filter descriptions (e.g., "Company Name contains 'Acme'")

### When Context is Sent

- On each `sendChatMessage`, the browsing context is compared to the **last sent context** (stored per-thread in `agentChatLastSentBrowsingContextFamilyState`)
- Context is only sent if it **changed** since the last message (diff check via `JSON.stringify`)
- Sent as the `browsingContext` variable in the `SEND_CHAT_MESSAGE` mutation

### UI Tool Calls: Navigation

The agent can drive navigation via tool calls. `useProcessUIToolCallMessage` watches for `execute_tool` parts with `toolName: 'navigate_app'` and processes:

- `navigateToObject` → navigates to the object's index page
- `navigateToRecord` → navigates to a specific record's detail page
- `navigateToView` → navigates to a specific saved view
- `wait` → sleeps for a duration (for chained navigation)

This is filtered by session start time (`agentChatUISessionStartTimeState`) to avoid re-processing tool calls from previous sessions.

---

## 10. Context Usage Tracking

### `AiChatContextUsageButton`

A **circular progress ring** in the editor toolbar that shows context window usage:

- Displays a percentage ring (blue → orange → red as usage increases)
- On hover, shows a detailed card with:
  - **Context window**: percentage, tokens used / total
  - **Last message**: input tokens, output tokens, cached %, cost
  - **Conversation**: total input/output tokens, total cost

Usage data comes from the streaming metadata in each assistant message:
```typescript
metadata.usage = {
  inputTokens, outputTokens, cachedInputTokens,
  inputCredits, outputCredits, conversationSize
};
metadata.model = { contextWindowTokens };
```

### Compaction

When the conversation exceeds the context window, the server performs **compaction**. This is indicated by a `data-compaction` part in the message, rendered as `AiChatCompactionIndicator` — a simple line saying "The conversation has been compacted" with a transform icon.

---

## 11. Workflow AI Agent Action

### `WorkflowEditActionAiAgent`

This is for configuring AI agents within **workflow automations** (not the interactive chat). It's a separate use case with different UI:

```
WorkflowEditActionAiAgent
├─ TabList: [Prompt, Permissions]
├─ Prompt Tab (WorkflowAiAgentPromptTab):
│   ├─ Model selector (Select dropdown)
│   ├─ Prompt input (FormTextFieldInput with WorkflowVariablePicker)
│   ├─ Model capabilities (SettingsAgentModelCapabilities)
│   └─ Output schema builder (WorkflowOutputSchemaBuilder)
├─ Permissions Tab (WorkflowAiAgentPermissionsTab):
│   ├─ Permission list (CRUD per object type)
│   └─ Flag permissions
└─ Footer with action buttons
```

**Key differences from the chat UI:**
- The prompt supports **workflow variables** (template interpolation from previous steps)
- Output schema can be defined (structured JSON output)
- Model capabilities are configurable (e.g., code interpreter, web search toggles)
- Permissions are per-agent (which CRM objects it can read/create/update/delete)
- Connected to a specific `Agent` entity via `agentId` (GraphQL: `FindOneAgent`, `UpdateOneAgent`)

---

## 12. Error Handling

### Error Types

The `AiChatErrorRenderer` handles:
1. **`BILLING_CREDITS_EXHAUSTED`**: Shows `AIChatNoMoreBillingCreditsBanner` (above editor, not inline)
2. **`API_KEY_NOT_CONFIGURED`**: Shows `AiChatApiKeyNotConfiguredMessage` (inline)
3. **Generic errors**: Shows `AiChatErrorMessage` (inline after the last message)

Errors from the stream (`stream-error` event) include a `code` field. The error is stored in `agentChatErrorComponentFamilyState` per-thread.

### Error Recovery

On send failure:
- Editor text is restored
- Optimistic message is removed
- Draft is restored to the correct thread key
- Uploaded files are restored
- Error is set in the error atom
- `AGENT_CHAT_RESTORE_EDITOR_CONTENT_EVENT_NAME` is dispatched to restore TipTap content

---

## 13. DB Part to UI Part Mapping

`mapDBPartToUIMessagePart` converts GraphQL message parts to the Vercel AI SDK UI message part format:

| DB `type` | UI Part Type | Key Fields |
|---|---|---|
| `text` | `{ type: 'text', text }` | `textContent` |
| `reasoning` | `{ type: 'reasoning', text, state, providerMetadata }` | `reasoningContent`, `state` |
| `file` | `{ type: 'file', mediaType, filename, url, fileId }` | `fileMediaType`, `fileFilename`, `fileUrl`, `fileId` |
| `source-url` | `{ type: 'source-url', sourceId, url, title }` | `sourceUrlSourceId`, `sourceUrlUrl`, `sourceUrlTitle` |
| `source-document` | `{ type: 'source-document', sourceId, mediaType, title, filename }` | `sourceDocument*` |
| `step-start` | `{ type: 'step-start' }` | — |
| `data-routing-status` | `{ type: 'data-routing-status', data: { text, state } }` | `textContent`, `state` |
| `tool-*` | `{ type: 'tool-*', toolCallId, input, output, errorText, state }` | `toolCallId`, `toolInput`, `toolOutput`, `errorMessage` |
| `dynamic-tool` | Same as tool but with `toolName` field | `toolName` |

---

## 14. Key Technical Patterns

### Browser Event Bus

The system uses a custom browser event system (`dispatchBrowserEvent` / `useListenToBrowserEvent`) instead of direct function calls for cross-component communication:

- `AGENT_CHAT_SEND_MESSAGE_EVENT_NAME` — trigger send
- `AGENT_CHAT_STOP_EVENT_NAME` — trigger stop
- `AGENT_CHAT_ENSURE_THREAD_FOR_DRAFT_EVENT_NAME` — auto-create thread
- `AGENT_CHAT_REFETCH_MESSAGES_EVENT_NAME` — refetch persisted messages
- `AGENT_CHAT_RESTORE_EDITOR_CONTENT_EVENT_NAME` — restore editor on error
- `SSE_CLIENT_RECONNECTED_EVENT_NAME` — SSE reconnected

### Thread Lifecycle

1. **Draft thread**: Created eagerly when user starts typing on the "new chat" slot
2. **Thread switch**: Saves current editor draft, loads new thread's messages and draft
3. **Thread switch detection**: `agentChatDisplayedThreadState` vs `currentAiChatThreadState` comparison
4. **Skeleton suppression**: `skipMessagesSkeletonUntilLoadedState` prevents flash of loading state on draft→real thread transition
5. **Thread created from draft**: `threadIdCreatedFromDraftState` tracks which thread was auto-created, used to keep editor key stable

### Component Instance Pattern

Jotai atoms use a `ComponentFamilyState` pattern:
```typescript
// Scoped by instanceId + familyKey
agentChatMessagesComponentFamilyState.atomFamily({
  instanceId: AGENT_CHAT_INSTANCE_ID,
  familyKey: { threadId }
})
```
This allows multiple independent chat instances (though currently only one is used).

---

## 15. Routing Status Display

When the AI agent selects which model/approach to use, it streams `data-routing-status` parts:

- **Loading state**: Shows shimmering text with CPU icon (e.g., "Choosing the best model…")
- **Routed state**: Shows static text (e.g., "Using Claude 3.5 Sonnet")
- **Debug mode** (`IS_DEBUG_MODE`): Expands to show routing debug info (scores, model selection rationale)
- **Error state**: Hidden (returns null)

---

## 16. Summary of Key Files

| File | Purpose |
|---|---|
| `AgentChatProvider.tsx` | Root provider, mounts effects |
| `AiChatTab.tsx` | Main chat page (messages + editor) |
| `AiChatTabMessageList.tsx` | Message list with scroll management |
| `AiChatMessage.tsx` | Individual message bubble |
| `AiChatAssistantMessageRenderer.tsx` | Routes parts to renderers |
| `ToolStepRenderer.tsx` | Tool call display (expandable, tabbed) |
| `ThinkingStepsDisplay.tsx` | Grouped reasoning/tool steps |
| `CodeExecutionDisplay.tsx` | Code interpreter output viewer |
| `LazyMarkdownRenderer.tsx` | Markdown rendering with record links |
| `AiChatEditorSection.tsx` | Input area with editor + controls |
| `useAgentChat.ts` | Send/stop message logic |
| `useAgentChatSubscription.ts` | SSE subscription + stream processing |
| `useBrowsingContext.ts` | Gathers current page context |
| `useProcessUIToolCallMessage.ts` | Handles agent-driven navigation |
| `useAiChatEditor.ts` | TipTap editor setup + keyboard handling |
| `mapDBPartToUIMessagePart.ts` | DB→UI message part conversion |
| `get-tool-display-message.ts` | Human-readable tool status messages |
| `AiChatThreadsList.tsx` | Thread list page |
| `AgentChatStreamKeepAliveEffect.tsx` | Stream liveness + recovery |
| `SidePanelPagesConfig.tsx` | Maps side panel page IDs to components |
| `WorkflowEditActionAiAgent.tsx` | Workflow AI agent config UI |
