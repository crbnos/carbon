// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect } from "react";
import { useNavigate } from "react-router";

// Fire-once guard across re-renders/remounts. navigate parts are never persisted,
// so a reopened thread never contains them and can't re-fire on reload.
const fired = new Set<string>();

/**
 * Goes to the page the navigate tool resolved on the server. The tool returns `{ url }`
 * for a page it could open and `{ error }` otherwise; only an in-app `/x/` url is followed.
 */
export function AgentNavigate({
  output,
  toolCallId
}: {
  output: unknown;
  toolCallId: string;
}) {
  const navigate = useNavigate();
  useEffect(() => {
    if (fired.has(toolCallId)) return;
    const url = (output as { url?: unknown } | undefined)?.url;
    if (typeof url !== "string" || !url.startsWith("/x/")) return;
    fired.add(toolCallId);
    navigate(url);
  }, [output, toolCallId, navigate]);
  return null;
}
