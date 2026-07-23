import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { type AgentProvider, agentProvider } from "@carbon/utils";
import type { LanguageModel } from "ai";

/**
 * Provider-agnostic model resolution for the in-app agent.
 *
 * The Vercel AI SDK (`ai`) is already provider-agnostic at the call site —
 * `streamText` / `generateText` accept any `LanguageModel`. This registry maps our
 * provider id (`agentProvider` in `@carbon/utils`) to the matching SDK provider
 * factory, so switching providers is a one-line config change with no call-site
 * edits. Each default provider reads its own key from the environment
 * (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`).
 *
 * Current default is OpenAI (see `agentProvider`). To add another provider
 * (e.g. DeepSeek): install `@ai-sdk/deepseek`, import its factory, add it to this
 * map, and extend the `AgentProvider` union in `@carbon/utils`.
 */
const providerFactories: Record<
  AgentProvider,
  (modelId: string) => LanguageModel
> = {
  openai,
  anthropic
};

/** Resolve a model id on the currently-configured agent provider. */
export function agentModel(modelId: string): LanguageModel {
  return providerFactories[agentProvider](modelId);
}
