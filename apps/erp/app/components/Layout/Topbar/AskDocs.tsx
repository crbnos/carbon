// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuCircleHelp } from "react-icons/lu";
import { useAgentAvailable } from "~/modules/agent/hooks/useAgentAvailable";
import { useAgentStore } from "~/stores/agent";

/**
 * Top-bar trigger for the docs assistant. Toggles the chat panel (also ⌘L). Hidden
 * when the agent isn't available to the company (plan-gated or admin-disabled),
 * mirroring the panel host in AgentRoot.
 */
export default function AskDocs() {
  const toggleAgent = useAgentStore((s) => s.toggleAgent);
  const available = useAgentAvailable();

  if (!available) return null;

  return (
    <Button
      aria-label="Question (⌘L)"
      variant="ghost"
      leftIcon={<LuCircleHelp />}
      className="hover:scale-100"
      onClick={() => toggleAgent()}
    >
      <Trans>Question</Trans>
    </Button>
  );
}
