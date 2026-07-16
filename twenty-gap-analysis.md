# What Closes the Gap Between Claude+MCP and a Framework Agent

## The Core Problem

Claude + a bare system prompt + MCP tools works great because:
1. Claude is excellent at tool calling natively
2. MCP does dynamic tool discovery (lazy schema loading)
3. Claude Desktop manages context and streaming transparently

A framework-mediated agent (Vercel AI SDK, Mastra, etc.) performs worse with the *same tools* because the framework adds indirection without adding intelligence. The model gets less guidance, makes more mistakes, and wastes context on failed tool calls.

## What Twenty Does to Close the Gap

### 1. A Deeply Structured System Prompt (~2,500 tokens)

The prompt isn't "you are a helpful assistant." It's a precise operating manual:

**Plan → Skill → Learn → Execute** — a 4-step workflow baked into the prompt:
1. Plan: identify the domain
2. Load the relevant skill FIRST (via `load_skills`)
3. Learn tool schemas (via `learn_tools` — batch, not one at a time)
4. Execute (via `execute_tool`)

The prompt explicitly says: "⚠️ NEVER call a specialized tool without loading its matching skill first."

**Domain-specific rules** that prevent common mistakes:
- "Use database tools for CRM data, NEVER construct API URLs"
- "For grouped analytics, use `group_by_*` instead of `find_many_*`"
- "`upsert_many_*` when each record needs different values, `update_many_*` when all get the same data"
- "Use small limits (5-10 records). Every record consumes context."
- "If a tool fails, analyze the error, adjust, try again. Don't give up after first failure."

**Response format rules:**
- Record references: `[[record:objectName:recordId:displayName]]` — clickable links
- "NEVER make up IDs. Copy exact format from tool response."
- "Use record references only in paragraphs, lists, or tables — never in headings or code"

### 2. Skills = Loadable Domain Expertise (the secret weapon)

Skills are NOT tools. They're detailed instruction documents (500-3000 tokens each) that teach the model *how* to use a set of tools correctly. The model loads them on demand via `load_skills`.

**14 standard skills**, each a mini operating manual:
- `workflow-building` — exact schema for CRON triggers, CODE steps, PICK_RECORD steps, troubleshooting failed runs
- `data-manipulation` — sorting syntax (`DescNullsLast`), bulk import recipe (single `code_interpreter` run, not loops), anti-patterns
- `xlsx` — "use formulas not hardcoded values", recalculation scripts, financial model color coding
- `code-interpreter` — sandbox conventions, `twenty` bridge object, `bulk_upsert`, `lookup_by` helpers
- `metadata-building` — field types, naming conventions, object/field management
- `view-building` — TABLE/KANBAN/CALENDAR view types, configuration parameters
- `view-filters-and-sorts` — operator tables by field type, date filter syntax
- `dashboard-building` — grid system, widget types, field resolution rules
- etc.

**Why this matters:** Without skills, the model guesses at tool schemas and gets them wrong. Sorting with `"desc"` instead of `"DescNullsLast"`. Creating KANBAN views without the required grouping field. Importing 10,000 records one at a time instead of batching. Skills eliminate an entire class of failures.

**Carbon equivalent:** We need skills for our domain — manufacturing-specific ones. How to query work orders, how BOMs nest, how to create quality inspections, how ECOs work. These teach the model our domain, not just our API.

### 3. Tool Catalog (Names Only, Not Schemas)

The system prompt includes a categorized list of all tool names — NOT schemas. For database CRUD:

```
Operations per object:
- `find_many_{object}`
- `find_one_{object}`
- `create_one_{object}`
...

Objects (45):
- `companies`
- `people`
- `opportunities`
...
```

This tells the model what exists (~200 tokens) without consuming context with schemas. The model discovers schemas via `learn_tools` before executing.

Pre-loaded tools (schemas in the prompt, callable directly) are marked with ✓. Only 1-2 tools are pre-loaded — everything else goes through learn → execute.

### 4. Tool Call Repair

When the model makes a malformed tool call (wrong enum value, incorrect structure), `repairToolCall` catches the validation error and runs a second `generateText` call to fix the input:

```
"The AI model attempted to call 'X' with invalid input.
Input: {...}
Error: {...}
Please fix the input to match the required schema."
```

This recovers from errors that would otherwise break the conversation. It does NOT attempt to repair invalid tool names (NoSuchToolError) — only schema mismatches.

### 5. Browsing Context Injection

Not in the system prompt — injected into the **last user message** as a `<browsing_context>` XML tag. The system prompt just says: "A <browsing_context> tag may appear. Only use it when directly relevant."

Context is diffed — only sent when it changes. Types:
- Record page: `{ type: 'recordPage', objectNameSingular, recordId }`
- List view: `{ type: 'listView', objectNameSingular, viewId, viewName, filterDescriptions[] }`

### 6. Data Efficiency Rules

Explicit in the prompt:
- "Use small limits (5-10 records) for initial exploration"
- "Always apply filters to narrow results"
- "Fetch one type of data at a time"
- "Every record returned consumes context. Fetching too many at once will cause failures."
- "For bulk operations, use batch tools, not loops"

These prevent the #1 failure mode of tool-calling agents: fetching too much data and blowing the context window.

### 7. Workspace + User Context

The prompt includes:
- Workspace-level custom instructions (admin-configured per tenant)
- User identity (name, locale, timezone)

This means the agent can say "Good morning, Brad" and format dates in the user's timezone.

---

## Summary: The Gap is Prompt Engineering + Skills

The framework doesn't matter much. What matters:

| What Claude+MCP does implicitly | What the framework agent needs explicitly |
|---|---|
| Claude's native tool-calling quality | Structured Plan→Skill→Learn→Execute workflow in the prompt |
| MCP lazy schema discovery | Meta-tools (learn_tools, execute_tool) + tool catalog in prompt |
| Claude recovers from errors intuitively | Tool call repair (second LLM pass on validation errors) |
| User provides context naturally | Browsing context injection |
| Claude manages context window | Explicit data efficiency rules + pruning |
| User knows the domain | Skills — loadable domain expertise documents |

The framework (Vercel AI SDK, Mastra, whatever) is just the plumbing. The intelligence gap is closed by:
1. A precise, domain-aware system prompt
2. Skills that teach the model how to use tools correctly
3. Tool call repair for error recovery
4. Data efficiency rules that prevent context blowout
