// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export const openAiCategorizationModel = "gpt-4o" as const;

/**
 * In-app agent model configuration.
 *
 * The Vercel AI SDK (`ai`) is provider-agnostic at the call site, so the agent is
 * too: the provider registry in `apps/erp/app/modules/agent/agent.provider.ts`
 * resolves `agentProvider` + these model ids to the right SDK provider. Swapping
 * providers is a config change here — no call-site edits.
 */
export type AgentProvider = "openai" | "anthropic";

export const agentProvider: AgentProvider = "openai";

// gpt-4.1-mini: 1M-token window, no reasoning tokens, a small fraction of GPT-4's price.
// Plain "gpt-4" (the 2023 model) has an 8k window: one long docs page overflowed it.
export const agentChatModel = "gpt-4.1-mini" as const; // main chat turns
export const agentTitleModel = "gpt-4o-mini" as const; // cheap: chat titles
