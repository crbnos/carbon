---
description: Vercel AI SDK usage in Carbon — versions, the v7 idioms in use, every call site, and the models configured
paths:
  - "apps/erp/app/routes/api+/ai+/**"
  - "apps/erp/app/modules/agent/**"
  - "apps/erp/app/modules/production/inspectionBalloonAnalyze.*"
  - "packages/utils/src/llm.ts"
  - "packages/database/supabase/functions/lib/ai/**"
---

# AI SDK Usage in Carbon

Carbon uses the [Vercel AI SDK](https://ai-sdk.dev/) **v7**. Versions live in the pnpm
catalog (`pnpm-workspace.yaml`): `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic` and
`@ai-sdk/react` must move together, because each provider release pins one
`@ai-sdk/provider-utils` and `@ai-sdk/react` pins an exact `ai`. `erp`, `ee` and `jobs`
all take `ai` from `catalog:`. v7 is ESM-only and needs Node ≥ 22.

`ai@4` still appears in the lockfile through `linguito` (the translation CLI, dev only).
That is expected and nothing imports it.

## v7 idioms (the deprecated v5/v6 names still compile; don't use them)

| Use | Not |
|---|---|
| `instructions` | `system` |
| `isStepCount(n)` | `stepCountIs(n)` |
| `onEnd` (on `streamText` and on UI streams) | `onFinish` |
| `event.usage` (all steps) | `totalUsage` |
| `usage.inputTokenDetails.cacheReadTokens` | `cachedInputTokens` |
| `await convertToModelMessages(...)` | the sync call (it is async now) |
| `createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream, … }) })` | `result.toUIMessageStreamResponse(…)` |
| `generateText({ output: Output.object({ schema, name?, description? }) })`, read `output` | `generateObject` / `schemaName` / `schemaDescription` |

## Structured extraction (`generateText` + `Output.object`)

| File | Model | Purpose |
|---|---|---|
| `apps/erp/app/routes/api+/ai+/csv+/$table.columns.tsx` | `gpt-4o` | Map CSV import columns → DB fields |
| `apps/erp/app/routes/x+/quote+/$quoteId.drag.tsx` | `gpt-4o-mini` | Parse 3D model filename → part id + revision |
| `apps/erp/app/modules/production/inspectionBalloonAnalyze.server.ts` | `gpt-4o` | Vision: dimension callouts from drawing crops |
| `packages/ee/src/accounting/core/account-mapping-ai.ts` | `openAiCategorizationModel` | Map GL accounts to a provider's chart |
| `packages/ee/src/paperless-parts/lib/lib.ts` (2) | `openAiCategorizationModel` | Substance / material properties |
| `packages/jobs/src/inngest/functions/tasks/onboard.ts` | `gpt-4o` | Lead quality (Warm/Cold) |

```ts
const { output } = await generateText({
  model: openai("gpt-4o"),
  output: Output.object({ schema }),
  prompt
});
```

`@ai-sdk/openai` 4 sends `Output.object` schemas in OpenAI's **strict** mode (v5 did not),
which refuses optional keys: every property must be required, with `.nullable()` for "may be
absent". A `.partial()` / `.optional()` schema fails with `invalid_json_schema` — and the CSV
column route used to swallow that and return no mappings. Design the schema for the ANSWER the
model gives (the CSV route asks for column names, so each field is a `z.string()`), not by
reusing a data validator.

## The in-app agent (streaming)

`apps/erp/app/modules/agent/` is the only streaming, multi-turn, tool-using use.
`streamChat` (`agent.server.ts`) runs `streamText`, converts its `stream` with the
standalone `toUIMessageStream` (`generateMessageId` mints the stored row's id; `onEnd`
persists the answer) and returns it with `createUIMessageStreamResponse`, where
`consumeSseStream: consumeStream` keeps `onEnd` running after a browser disconnect.
A model error is recorded by `streamText`'s `onError`, not by the UI stream's outcome.
The browser side is `useChat` + `DefaultChatTransport` from `@ai-sdk/react`
(`hooks/useAgentThread.ts`). History, persistence and the docs tools are covered in
`agent-knowledge-base.md`.

The provider registry (`agent.provider.ts`) is the only importer of `@ai-sdk/anthropic`.
The runtime provider is `agentProvider` (`openai`) in `packages/utils/src/llm.ts`, with
`agentChatModel` (`gpt-4.1-mini`) and `agentTitleModel` (`gpt-4o-mini`).

## Edge functions

`packages/database/supabase/functions/lib/ai/openai.ts` pins its own
`npm:@ai-sdk/openai@2.0.60` (Deno, self-contained); only `transcription` imports it. It is
not on the catalog and does not follow the app's version.
