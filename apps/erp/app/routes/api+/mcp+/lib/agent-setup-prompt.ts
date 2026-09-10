/**
 * The agent-facing "connect this MCP server" prompt, served as markdown at
 * `/agent-setup/prompt.md`. Point an AI agent at that URL and it has everything
 * it needs to wire up its own client.
 *
 * The markdown body lives in `agent-setup-prompt.md` (raw text, so its code
 * fences and `${...}` placeholders survive verbatim) and is imported with Vite's
 * `?raw` suffix. The endpoint is injected from the caller's origin rather than
 * hard-coded, so a self-hosted or ITAR instance advertises its OWN endpoint —
 * the same reason `buildMcpManifest` takes an origin instead of reading env.
 */

import promptTemplate from "./agent-setup-prompt.md?raw";

export function buildAgentSetupPrompt(origin: string): string {
  const endpoint = `${origin}/api/mcp`;

  return promptTemplate
    .replaceAll("{{MCP_URL}}", endpoint)
    .replaceAll("{{ORIGIN}}", origin);
}
