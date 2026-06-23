---
description: Vercel AI SDK usage in Carbon — what AI features actually exist, which models are configured, and the stale chat-edge-function scaffold
paths:
  - "apps/erp/app/routes/api+/ai+/**"
  - "apps/erp/app/modules/quality/inspectionBalloonAnalyze.*"
  - "packages/utils/src/llm.ts"
  - "packages/database/supabase/functions/lib/ai/**"
---

# AI SDK Usage in Carbon

Carbon uses the [Vercel AI SDK](https://sdk.vercel.ai/) (`ai` v5) for its AI
features. There is **no chat interface, no streaming conversation, and no
Anthropic/Claude usage in practice.** Every active AI call is a one-shot
`generateObject` extraction against OpenAI.

> ⚠️ An earlier internal doc described a chat edge
> function at `packages/database/supabase/functions/chat/index.ts` and an
> `Agent.ee.tsx` frontend component using `@ai-sdk/anthropic`. **Neither exists
> in the current codebase** — that was a scaffold that was never shipped (or was
> removed). Treat the sections below as the source of truth.

## Packages (`apps/erp/package.json`)

- `ai` `5.0.172` — core SDK (`generateObject`, etc.)
- `@ai-sdk/openai` (catalog `2.0.102` in `pnpm-workspace.yaml`) — **the provider actually used**
- `@ai-sdk/anthropic` `2.0.74` — **declared but never imported anywhere in source**
- `@ai-sdk/react` `2.0.174` and the `@ai-sdk-tools/*` suite (`agents`, `artifacts`,
  `cache`, `devtools`, `memory`, `store`, all `1.2.0`) — **installed but unused** (no
  `useChat`, no transport, no chat UI anywhere in `apps/erp`)

`packages/jobs` and `packages/ee` also depend on `ai` `5.0.172` + `@ai-sdk/openai`.

## Model IDs configured now

`packages/utils/src/llm.ts`:

```ts
export const openAiCategorizationModel = "gpt-4o" as const;
export const anthropicAgentModel = "claude-3-7-sonnet-20250219" as const;
```

- `openAiCategorizationModel` (`gpt-4o`) — the OpenAI model for categorization-style work.
- `anthropicAgentModel` — **dead code.** It is exported but imported by nothing, and it
  pins `claude-3-7-sonnet-20250219`, which **retired on 2026-02-19** and now returns a
  404 if ever called. If this constant is ever revived, the drop-in replacement is
  `claude-sonnet-4-6` (or `claude-opus-4-8` for the most capable Opus tier) — do not
  re-use the retired id. <!-- UNVERIFIED: intended use of anthropicAgentModel — it has no call sites -->

Note: the three active call sites below pass the literal model string to `openai(...)`
directly; they do **not** import `openAiCategorizationModel`. Two use `gpt-4o`, one uses
`gpt-4o-mini`.

## Active AI call sites (all OpenAI, all `generateObject`)

| File | Model | Purpose |
|---|---|---|
| `apps/erp/app/routes/api+/ai+/csv+/$table.columns.tsx` | `gpt-4o` | Map CSV import columns → DB fields |
| `apps/erp/app/routes/x+/quote+/$quoteId.drag.tsx` | `gpt-4o-mini` | Parse 3D model filename → part id + revision |
| `apps/erp/app/modules/quality/inspectionBalloonAnalyze.server.ts` | `gpt-4o` | Vision: extract dimension callouts from CAD drawing crops |

Each imports `{ openai } from "@ai-sdk/openai"` and `{ generateObject } from "ai"`, then:

```ts
const { object } = await generateObject({
  model: openai("gpt-4o"),
  schema: /* zod schema */,
  // prompt / messages
});
```

These run server-side (route actions / `.server.ts`). `OPENAI_API_KEY` is read from the
environment by the provider.

## Supabase edge-function OpenAI helper

`packages/database/supabase/functions/lib/ai/openai.ts` builds a Deno-side OpenAI client:

```ts
import { createOpenAI } from "npm:@ai-sdk/openai@2.0.60";
export const openai = createOpenAI({ /* apiKey from Deno.env */ });
```

This is the Deno/edge-function equivalent of the npm provider. Verify call sites before
assuming it's wired into anything. <!-- UNVERIFIED: which edge functions consume this helper -->

## Gotchas

- **Don't reach for `@ai-sdk/anthropic` / Claude.** No code uses it; adding Anthropic
  means choosing a current model id (`claude-opus-4-8` / `claude-sonnet-4-6`) and a real
  API key path — not the retired constant in `llm.ts`.
- **The `@ai-sdk-tools/*` and `@ai-sdk/react` deps are dead weight** today. If you build a
  chat UI, that's where `useChat` + a transport would live — but none exists yet.
- **No streaming, no `streamText`, no multi-turn.** All usage is single-shot structured
  extraction via `generateObject`. The old doc's `doGenerate` / `finishReason: "tool-calls"`
  / MCP-tool-loop description does not match anything in the tree.
- The `.ee.tsx` (enterprise edition) convention exists, but only for the Configurator
  (`apps/erp/app/components/Configurator/**`) — there is no `Agent`/chat `.ee.tsx`.
