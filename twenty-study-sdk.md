# Twenty CRM — SDK Agent System & Apps Framework

Deep study of how Twenty defines, provisions, executes, and exposes AI agents through its SDK, apps framework, and server engine.

---

## 1. SDK Agent Definition API

### `defineAgent()` — The Developer-Facing API

Location: `packages/twenty-sdk/src/sdk/define/agents/define-agent.ts`

The SDK exposes a `defineAgent()` function that validates and registers an agent manifest. It takes an `AgentManifest` config object:

```typescript
// AgentManifest (from twenty-shared/src/application/agentManifestType.ts)
type AgentManifest = SyncableEntityOptions & {
  name: string;          // Internal identifier (kebab-case)
  label: string;         // Human-readable display name
  icon?: string;         // Icon name (e.g., 'IconRobot')
  description?: string;  // What the agent does
  prompt: string;        // System prompt — the agent's instructions
  modelId?: string;      // LLM model ID (defaults to auto-select)
  responseFormat?: AgentResponseFormat;  // text or JSON schema
};

// SyncableEntityOptions = { universalIdentifier: string }
```

**Validation rules** enforced by `defineAgent()`:
- `universalIdentifier` is required (UUID)
- `name` is required
- `label` is required
- `prompt` is required
- `responseFormat` is optional (warns if missing; defaults to `{ type: 'text' }`)

### Example Agent Definition (from postcard app)

```typescript
import { defineAgent } from 'twenty-sdk/define';

export default defineAgent({
  universalIdentifier: 'b8d4f2a3-9c5e-4f7b-a012-3e4d5c6b7a8f',
  name: 'postcard-drafter',
  label: 'Postcard Drafter',
  icon: 'IconRobot',
  description: 'Helps draft postcard messages',
  prompt:
    'You are a postcard writing assistant. Help users draft concise, warm ' +
    'postcard messages. Follow the postcard writing guidelines. Ask for the ' +
    'recipient name and the occasion if not provided.',
});
```

### Response Format System

Agents can output either plain text or structured JSON:

```typescript
type AgentResponseFormat =
  | { type: 'text' }           // Free-form text output
  | { type: 'json'; schema: AgentResponseSchema };  // Structured output

type AgentResponseSchema = {
  type: 'object';
  properties: Record<string, {
    type: 'string' | 'number' | 'boolean';
    description?: string;
  }>;
  required?: string[];
  additionalProperties?: false;
};
```

When `responseFormat` is `json`, the engine runs a **two-pass execution**: first `generateText` with tools to do work, then a second `generateText` pass with `Output.object()` to convert results into the specified JSON schema.

---

## 2. Skill Definition API

### `defineSkill()` — Knowledge Modules for Agents

Location: `packages/twenty-sdk/src/sdk/define/skills/define-skill.ts`

Skills are **knowledge documents** that provide context and expertise to agents. They are NOT tools — they are loaded text that teaches agents how to do things.

```typescript
// SkillManifest (from twenty-shared/src/application/skillManifestType.ts)
type SkillManifest = SyncableEntityOptions & {
  name: string;          // Identifier
  label: string;         // Display name
  icon?: string;
  description?: string;
  content: string;       // The actual skill instructions (markdown)
};
```

Example:

```typescript
import { defineSkill } from 'twenty-sdk/define';

export default defineSkill({
  universalIdentifier: 'a7c3e1f2-8b4d-4e6a-9f01-2d3c4b5a6e7f',
  name: 'postcard-writing-guidelines',
  label: 'Postcard Writing Guidelines',
  content: 'When writing a postcard: keep the message under 150 words, ...',
});
```

### Skill Entity (Server-Side)

```typescript
// SkillEntity — stored in Postgres
class SkillEntity extends SyncableEntity {
  id: string;              // UUID
  name: string;
  label: string;
  icon: string | null;
  description: string | null;
  content: string;         // The skill text
  isCustom: boolean;       // false = standard, true = user-created
  isActive: boolean;       // Can be deactivated
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 3. Tool System — How Agents Get Capabilities

### Architecture Overview

Twenty's tool system uses a **provider-based registry pattern**. Tools are NOT defined on agents — they are dynamically assembled based on the agent's role permissions and the workspace's data model.

```
ToolRegistryService (central registry)
  ├── ToolProvider[] (pluggable providers, one per category)
  │   ├── DATABASE_CRUD    — auto-generated CRUD tools for every active object
  │   ├── ACTION           — HTTP requests, email, calendar, code interpreter
  │   ├── WORKFLOW         — workflow creation/management
  │   ├── METADATA         — schema management (create objects, fields)
  │   ├── VIEW             — manage views, filters, sorts
  │   ├── DASHBOARD        — create/manage dashboards
  │   ├── LOGIC_FUNCTION   — custom app logic functions
  │   ├── NAVIGATION_MENU_ITEM — sidebar entries
  │   └── WEBHOOK          — outgoing webhooks
  └── NativeToolBinderService (model-native tools)
      ├── web_search (Anthropic, OpenAI, xAI)
      └── x_search (xAI only)
```

### Tool Categories (`ToolCategory` enum)

```typescript
enum ToolCategory {
  DATABASE_CRUD        = 'DATABASE_CRUD',
  ACTION               = 'ACTION',
  WORKFLOW             = 'WORKFLOW',
  METADATA             = 'METADATA',
  VIEW                 = 'VIEW',
  DASHBOARD            = 'DASHBOARD',
  NAVIGATION_MENU_ITEM = 'NAVIGATION_MENU_ITEM',
  WEBHOOK              = 'WEBHOOK',
  LOGIC_FUNCTION       = 'LOGIC_FUNCTION',
}
```

### ToolProvider Interface

Each category is backed by a provider that implements:

```typescript
interface ToolProvider {
  readonly category: ToolCategory;
  isAvailable(context: ToolProviderContext): Promise<boolean>;
  generateDescriptors(context, options): Promise<(ToolIndexEntry | ToolDescriptor)[]>;
  executeStaticTool(toolName, args, context): Promise<ToolOutput>;
}
```

### Tool Resolution for Agents

**For workflow agents (async execution)**, only two categories are loaded:
```typescript
const WORKFLOW_AGENT_REGISTRY_TOOL_CATEGORIES: ToolCategory[] = [
  ToolCategory.DATABASE_CRUD,
  ToolCategory.ACTION,
];
```
This deliberately excludes `WORKFLOW` to prevent circular/recursive execution.

**For AI chat agents (user-facing)**, ALL categories are available, plus a skill-loading mechanism:
- `load_skills` — Load skill documents by name
- `learn_tools` — Discover tool schemas (lazy loading)
- `execute_tool` — Execute any tool by name

### Tool Scoping by Role

Tools are scoped by the agent's assigned **role**. Each agent can have a role (via `RoleTarget`), and that role controls which objects/fields the agent can read/write. No role = no registry tools.

```typescript
// From agent-async-executor.service.ts
const agentRoleId = await this.getAgentRoleId(agent.id, agent.workspaceId);

// Only get tools if agent has a role
if (isDefined(agentRoleId)) {
  registryTools = await this.toolRegistry.getToolsByCategories(
    toolProviderContext,
    { categories: WORKFLOW_AGENT_REGISTRY_TOOL_CATEGORIES },
  );
}
```

### Native Model Tools

Some LLM providers expose built-in tools (web search, X/Twitter search). These are bound based on the model's SDK package and agent configuration:

```typescript
// Per-model native tools
NATIVE_MODEL_TOOLS_BY_SDK_PACKAGE = {
  '@ai-sdk/anthropic': { webSearch: { kind: 'sdk-tool', directToolName: 'web_search' } },
  '@ai-sdk/openai':    { webSearch: { kind: 'sdk-tool', directToolName: 'web_search' } },
  '@ai-sdk/xai':       { webSearch: ..., twitterSearch: { kind: 'sdk-tool', directToolName: 'x_search' } },
  '@ai-sdk/google':    {},
  '@ai-sdk/mistral':   {},
  // ...
};
```

These are enabled per-agent via `modelConfiguration`:
```typescript
agent.modelConfiguration?.webSearch?.enabled === true
agent.modelConfiguration?.twitterSearch?.enabled === true
```

### Built-in Action Tools

Located in `packages/twenty-server/src/engine/core-modules/tool/tools/`:
- **http-tool** — Make HTTP requests to external APIs
- **email-tool** — Draft and send emails
- **send-email-tool** — Direct email sending
- **calendar-tool** — Calendar operations
- **navigate-tool** — Navigate the UI
- **output-navigation-tool** — Navigate output/data
- **search-help-center-tool** — Search Twenty documentation
- **code-interpreter-tool** — Execute Python code in sandbox

### Tool Repair

When an LLM makes a malformed tool call, the system uses `repairToolCall()` — it feeds the broken input + error message back to the LLM with `Output.object()` to fix the schema. This happens automatically via Vercel AI SDK's `experimental_repairToolCall`.

---

## 4. Agent Execution Engine

### Two Execution Contexts

**1. Workflow Agent Execution** (`AgentAsyncExecutorService`)
- Used when an agent runs as a workflow step (`AI_AGENT` action type)
- Also used via the `runAgent` SDK function from logic functions
- Gets `DATABASE_CRUD` + `ACTION` tools only
- Uses the workflow system prompts (`WORKFLOW_SYSTEM_PROMPTS`)
- Has billing/credit tracking and step counting (max 300 steps)
- Supports structured output via two-pass generation

**2. Chat Agent Execution** (`ChatExecutionService` / `AgentChatStreamingService`)
- User-facing conversational interface
- Gets ALL tool categories + lazy loading via `learn_tools` / `execute_tool`
- Uses chat system prompts (`CHAT_SYSTEM_PROMPTS`)
- Skills are listed in the system prompt and loaded on demand via `load_skills`
- Supports browsing context (knows what page the user is on)
- Streaming responses

### AgentEntity — Server-Side Database Representation

```typescript
@Entity('agent')
class AgentEntity extends SyncableEntity {
  id: string;
  name: string;
  label: string;
  icon: string | null;
  description: string | null;
  prompt: string;                          // System prompt
  modelId: ModelId;                        // LLM model (default: auto-select)
  responseFormat: AgentResponseFormat;     // text or json schema
  isCustom: boolean;                       // false = standard agent
  modelConfiguration: ModelConfiguration;  // web search, twitter search toggles
  evaluationInputs: string[];             // For agent monitoring/grading
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
```

### Agent Configuration Constants

```typescript
const AGENT_CONFIG = {
  MAX_STEPS: 300,                // Maximum tool-call steps per execution
  REASONING_BUDGET_TOKENS: 12000, // Reasoning token budget
};
```

### SDK `runAgent()` — Invoking Agents from Logic Functions

From within a Twenty app's logic function, you can invoke an agent:

```typescript
import { runAgent } from 'twenty-sdk';

const result = await runAgent({
  agentUniversalIdentifier: 'b8d4f2a3-9c5e-4f7b-a012-3e4d5c6b7a8f',
  prompt: 'Draft a postcard for John, congratulating him on his promotion',
});
// result: { result: object | null, error: string | null, success: boolean }
```

This sends a GraphQL mutation to the server:
```graphql
mutation RunAgent($input: RunAgentInput!) {
  runAgent(input: $input) {
    result
    error
    success
  }
}
```

The server resolves the agent by `universalIdentifier`, determines its application context, and executes via `AgentAsyncExecutorService`.

### Workflows Can Use Agents

In workflow definitions, an `AI_AGENT` step type invokes an agent:

```typescript
// Workflow AI Agent Action Schema
{
  type: 'AI_AGENT',
  settings: {
    input: {
      agentId: string,    // Agent UUID
      prompt: string,     // User prompt for this workflow step
    }
  }
}
```

---

## 5. Flat Agent System — Caching & Performance Layer

### What is a "Flat" Entity?

The "flat" pattern is Twenty's **caching and normalization layer**. Raw database entities (with ORM relationships, dates as Date objects, etc.) are transformed into "flat" representations (plain objects with string dates, denormalized application identifiers) that can be cached in memory.

```typescript
type FlatAgent = FlatEntityFrom<AgentEntity>;
// Basically: same shape as AgentEntity but with:
// - dates as ISO strings
// - applicationUniversalIdentifier denormalized in
// - deletedAt included for soft-delete tracking

type FlatAgentWithRoleId = FlatAgent & { roleId: string | null };
```

### FlatAgentMaps — The Cache Structure

```typescript
type FlatAgentMaps = FlatEntityMaps<FlatAgent>;
// Contains:
// - byId: Record<id, FlatAgent>
// - byUniversalIdentifier: Record<uid, FlatAgent>
```

### Cache Service

`WorkspaceFlatAgentMapCacheService` (decorated with `@WorkspaceCache('flatAgentMaps')`) computes and caches all agents for a workspace:

1. Fetches all `AgentEntity` records (including soft-deleted)
2. Fetches all `ApplicationEntity` records to build ID→UID mapping
3. Transforms each entity to a `FlatAgent`
4. Returns `FlatAgentMaps` for fast lookups by ID or universalIdentifier

### Role Target Cache

`WorkspaceFlatRoleTargetByAgentIdService` (cached as `flatRoleTargetByAgentIdMaps`) maps each agent ID to its assigned role target, enabling fast permission lookups.

### Editable Properties

Only these properties can be updated on an agent:
```typescript
const FLAT_AGENT_EDITABLE_PROPERTIES = [
  'name', 'label', 'icon', 'description', 'prompt',
  'modelId', 'responseFormat', 'modelConfiguration', 'evaluationInputs',
];
```

---

## 6. Apps Framework — How Twenty Apps Expose Agents

### Application Manifest Structure

Every Twenty app has a manifest (`Manifest` type) that includes agents and skills alongside all other app entities:

```typescript
type Manifest = {
  application: ApplicationManifest;
  objects: ObjectManifest[];
  fields: FieldManifest[];
  logicFunctions: LogicFunctionManifest[];
  roles: RoleManifest[];
  skills: SkillManifest[];     // ← Skills bundled with the app
  agents: AgentManifest[];     // ← Agents bundled with the app
  views: ViewManifest[];
  // ... frontComponents, pageLayouts, navigationMenuItems, etc.
};
```

### App Directory Convention

Apps follow a convention-over-configuration directory structure:

```
my-app/
  src/
    application.config.ts     ← defineApplication({ ... })
    agents/
      my-agent.agent.ts       ← defineAgent({ ... })
    skills/
      my-skill.skill.ts       ← defineSkill({ ... })
    roles/
      default-role.ts         ← defineRole({ ... })
    objects/
      my-object.object.ts     ← defineObject({ ... })
    logic-functions/
      post-install.ts
      pre-install.ts
    views/
    fields/
    navigation-menu-items/
```

### Application Config

```typescript
import { defineApplication } from 'twenty-sdk/define';

export default defineApplication({
  universalIdentifier: '8b2df3cc-23ad-4e1b-87fd-f880d4cefd58',
  displayName: 'Postcard App',
  description: 'Send postcards easily with Twenty',
  applicationVariables: { ... },
  serverVariables: { ... },
  defaultRoleUniversalIdentifier: DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
});
```

### Role System for Agents

Roles control what an agent can do. Each role defines:

```typescript
defineRole({
  universalIdentifier: '...',
  label: 'Default function role',
  canReadAllObjectRecords: false,
  canUpdateAllObjectRecords: false,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  canUpdateAllSettings: false,
  canBeAssignedToAgents: false,    // ← Whether this role can be assigned to agents
  canBeAssignedToUsers: false,
  canBeAssignedToApiKeys: false,
  objectPermissions: [
    { objectUniversalIdentifier: '...', canReadObjectRecords: true, ... },
  ],
  fieldPermissions: [
    { objectUniversalIdentifier: '...', fieldUniversalIdentifier: '...', canReadFieldValue: false, ... },
  ],
  permissionFlagUniversalIdentifiers: [SystemPermissionFlag.APPLICATIONS],
});
```

Agents are assigned roles via `RoleTarget` entities, which link an agent ID to a role ID.

---

## 7. Standard (Built-in) Agents

### The Helper Agent

Twenty ships with **one standard agent** — the **Helper**:

```typescript
const STANDARD_AGENT = {
  helper: { universalIdentifier: '20202020-c7ab-4065-b822-0ca1d5de60a9' },
};
```

The Helper agent's configuration:
- **Name**: `helper`
- **Label**: `Helper`
- **Icon**: `IconHelp`
- **Description**: "AI agent specialized in helping users learn how to use Twenty CRM"
- **Model**: Auto-select smart model
- **Response Format**: Text
- **Prompt**: Uses the `search_help_center` tool to find relevant documentation and answer user questions about Twenty features, setup, and usage

### Standard Skills (14 total)

These are knowledge modules that the chat agent can load on demand:

| Skill | Description |
|-------|-------------|
| `workflow-building` | Creating automation workflows with triggers and steps |
| `data-manipulation` | Searching, filtering, CRUD, bulk import with code interpreter |
| `dashboard-building` | Dashboards with widgets and layouts *(currently disabled)* |
| `metadata-building` | Data model: objects, fields, relations |
| `research` | Web search, competitive intelligence, fact-finding |
| `code-interpreter` | Python sandbox for analysis, charts, MCP bridge to Twenty tools |
| `xlsx` | Excel/spreadsheet creation, formulas, analysis |
| `pdf` | PDF form filling, extraction, merging, splitting |
| `docx` | Word document creation, editing, OOXML manipulation |
| `pptx` | PowerPoint processing |
| `workspace-demo-seeding` | Transform workspace into a domain-specific demo |
| `view-building` | Create table, kanban, calendar views |
| `view-filters-and-sorts` | Add filters and sorts to views |
| `custom-objects-cleanup` | Archive existing custom objects |

Each skill is a detailed markdown document with instructions, examples, constraints, and anti-patterns. Skills are loaded by the chat agent on demand via the `load_skills` tool — they are NOT embedded in every prompt. The system prompt lists available skills as a catalog, and the agent loads the relevant one before attempting a task.

---

## 8. Agent Migration & Provisioning

### How Agents Are Set Up in a Workspace

Agent provisioning follows Twenty's **universal migration system**:

1. **Standard agent metadata** is defined in builders (`STANDARD_FLAT_AGENT_METADATA_BUILDERS_BY_AGENT_NAME`)
2. On workspace creation/migration, `buildStandardFlatAgentMetadataMaps()` generates flat agent metadata for all standard agents
3. The migration builder (`WorkspaceMigrationAgentActionsBuilderService`) validates and produces migration actions (create/update/delete)
4. Migration actions are validated by `FlatAgentValidatorService`
5. The migration runner applies actions to the database

### Migration Action Types

```typescript
type FlatCreateAgentAction = BaseFlatCreateWorkspaceMigrationAction<'agent'>;
type FlatUpdateAgentAction = BaseFlatUpdateWorkspaceMigrationAction<'agent'>;
type FlatDeleteAgentAction = BaseFlatDeleteWorkspaceMigrationAction<'agent'>;
```

### Application-Level Agent Sync

When a Twenty app (e.g., the postcard app) is installed:
1. The app manifest declares agents in `agents: AgentManifest[]`
2. The sync system compares the app's agent manifests against existing workspace agents
3. New agents are created, existing ones updated, removed ones soft-deleted
4. Each agent is scoped to its application via `applicationId`
5. Agents inherit the app's `universalIdentifier` for tracking

### GraphQL CRUD for Agents

The `AgentResolver` exposes GraphQL mutations/queries:

```graphql
# Queries
findManyAgents: [Agent!]!
findOneAgent(input: AgentIdInput!): Agent!

# Mutations (require AI_SETTINGS permission)
createOneAgent(input: CreateAgentInput!): Agent!
updateOneAgent(input: UpdateAgentInput!): Agent!
deleteOneAgent(input: AgentIdInput!): Agent!
```

Custom (user-created) agents set `isCustom: true` and belong to the workspace's custom application.

---

## 9. Agent Monitoring & Evaluation

Twenty includes an agent monitoring subsystem:

- **`AgentTurnEvaluation`** entity tracks evaluation results per agent turn
- **`AgentTurnGraderService`** grades agent responses
- **`evaluationInputs`** on the agent entity define test inputs for evaluation
- Jobs: `evaluate-agent-turn.job.ts`, `run-evaluation-input.job.ts`

This enables A/B testing of prompt changes and model swaps.

---

## 10. AI Chat Integration — How It All Comes Together

### System Prompt Construction

The `SystemPromptBuilderService` builds the complete system prompt by composing:

1. **Base instructions** — Core behavior, Plan→Skill→Learn→Execute workflow
2. **Browsing context** — What page the user is on
3. **Response format** — Markdown formatting rules
4. **Workspace instructions** — Custom admin-provided instructions
5. **User context** — Name, locale, timezone
6. **Tool catalog** — All available tools grouped by category, with preloaded tools marked
7. **Skill catalog** — All available skills listed for on-demand loading
8. **Uploaded files** — If the user uploaded files for processing

### Chat Flow

```
User message → SystemPromptBuilder.buildFullPrompt()
  → Tools: preloaded tools (learn_tools, execute_tool, load_skills, ...)
           + lazy-loaded tools via execute_tool
  → Skills: loaded on demand via load_skills
  → generateText() with streaming
  → Tool calls → ToolExecutorService.dispatch()
  → Response streamed back to user
```

### Key Design Decisions

1. **Lazy tool loading**: The chat agent doesn't get all tool schemas upfront — it discovers them via `learn_tools` and executes via `execute_tool`. This keeps the context window manageable.
2. **Skill-first workflow**: Before attempting any complex task, the agent is instructed to load the relevant skill first. This ensures correct schemas and patterns.
3. **Role-scoped tools**: Both chat and workflow agents are constrained by their assigned role's permissions.
4. **No circular workflows**: Workflow agents can't invoke other workflows (WORKFLOW tool category excluded).
5. **Agent-per-app isolation**: Each app's agents belong to that application and use its role context.

---

## Summary: Key Abstractions

| Concept | Location | Purpose |
|---------|----------|---------|
| `defineAgent()` | twenty-sdk | Declare agent in app manifest |
| `defineSkill()` | twenty-sdk | Declare skill knowledge document |
| `AgentManifest` | twenty-shared | Type contract for agents |
| `AgentEntity` | twenty-server | Database entity for agents |
| `FlatAgent` | twenty-server | Cached/normalized agent representation |
| `ToolProvider` | twenty-server | Pluggable tool category provider |
| `ToolRegistryService` | twenty-server | Central tool discovery & execution |
| `AgentAsyncExecutorService` | twenty-server | Workflow agent execution engine |
| `SystemPromptBuilderService` | twenty-server | Chat agent prompt assembly |
| `AgentService` | twenty-server | CRUD operations on agents |
| `SkillEntity` | twenty-server | Database entity for skills |
| `runAgent()` | twenty-sdk | SDK function to invoke agent from logic functions |
| `WorkspaceMigrationAgentActionsBuilderService` | twenty-server | Agent provisioning via migrations |
