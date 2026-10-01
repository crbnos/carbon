// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { usePlanGate } from "~/hooks/usePlanGate";

/**
 * Whether the in-app agent ("Ask Carbon") is available to the current company.
 *
 * Mirrors the server gate: the agent is hidden when the company's plan doesn't
 * include it (`usePlanGate`) — so the trigger never appears where a send would
 * 402. Shared by the topbar trigger (AskDocs) and the always-mounted panel
 * host (AgentRoot).
 */
export function useAgentAvailable(): boolean {
  const { isGated } = usePlanGate({ feature: "AI_AGENT" });
  return !isGated;
}
