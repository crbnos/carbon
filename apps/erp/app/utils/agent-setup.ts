// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The clipboard payload of the "connect your AI assistant" offers (the home
// page widget and Implementation Hub 2.0's priority set): a short prompt the user
// pastes into their AI tool, which points the agent at this instance's public
// setup doc (served by `agent-setup.prompt[.]md.tsx`). Pass `getAppUrl()`, this
// deployment's own origin, so a self-hosted / ITAR instance links to itself.
export function buildAgentSetupMessage(origin: string) {
  return `Onboard yourself to my Carbon ERP instance over MCP.

Read the setup instructions at ${origin}/agent-setup/prompt.md and follow them to connect your MCP client to ${origin}/api/mcp, then verify the connection works.`;
}
