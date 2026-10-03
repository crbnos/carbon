// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createContext, useContext } from "react";

// Lets UI-block components (rendered deep inside AgentMessage) send a follow-up
// message without prop-drilling through the message tree.
type AgentActions = { sendMessage: (text: string) => void };

const Ctx = createContext<AgentActions | null>(null);

export const AgentActionsProvider = Ctx.Provider;

export function useAgentActions(): AgentActions {
  const value = useContext(Ctx);
  if (!value) {
    throw new Error("useAgentActions must be used within AgentActionsProvider");
  }
  return value;
}
