// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button } from "@carbon/react";
import { useState } from "react";
import { buttonBlock } from "../../agent.blocks";
import { useAgentActions } from "../AgentActionsContext";

export function AgentBlockButton({ input }: { input: unknown }) {
  const { sendMessage } = useAgentActions();
  const [sent, setSent] = useState(false);
  const parsed = buttonBlock.safeParse(input);
  if (!parsed.success) return null;
  const { label, message } = parsed.data;
  return (
    <Button
      variant="secondary"
      size="sm"
      className="my-1"
      isDisabled={sent}
      onClick={() => {
        setSent(true);
        sendMessage(message);
      }}
    >
      {label}
    </Button>
  );
}
