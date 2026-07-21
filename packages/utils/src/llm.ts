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

export const agentChatModel = "gpt-4" as const; // main chat turns
export const agentTitleModel = "gpt-4o-mini" as const; // cheap: chat titles
