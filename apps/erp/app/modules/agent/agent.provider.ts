import { anthropic } from "@ai-sdk/anthropic";

/**
 * In-app agent model provider.
 *
 * Mirrors the existing OpenAI call sites (e.g. `api+/ai+/csv+/$table.columns.tsx`,
 * which use the default `openai(...)` provider): the default `anthropic` provider
 * reads `ANTHROPIC_API_KEY` from `process.env` automatically. `ANTHROPIC_API_KEY`
 * is a documented env var (`.env.example`); it is not funneled through `@carbon/env`.
 */
export { anthropic };
