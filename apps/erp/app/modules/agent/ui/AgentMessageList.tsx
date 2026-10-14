// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button } from "@carbon/react";
import type { UIMessage } from "ai";
import { AgentGreeting } from "./AgentGreeting";
import { AgentMessage } from "./AgentMessage";
import { AgentThinking } from "./AgentThinking";

export function AgentMessageList({
  messages,
  threadId,
  error,
  isStreaming,
  onRetry
}: {
  messages: UIMessage[];
  threadId: string | null;
  error?: Error;
  isStreaming: boolean;
  onRetry: () => void;
}) {
  const errorRow = error && (
    <div className="flex items-center gap-2 text-sm text-destructive">
      {/* The server's own message (rate limit, a failed turn); never raw internals. */}
      <span>{error.message || "Something went wrong."}</span>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );

  // A first question can fail before any message exists (the thread was not created).
  if (messages.length === 0) {
    return (
      <>
        <AgentGreeting />
        {errorRow && <div className="px-3 pb-3">{errorRow}</div>}
      </>
    );
  }

  const lastAssistantIndex = messages
    .map((m) => m.role)
    .lastIndexOf("assistant");

  // Show the thinking dots while streaming until visible assistant text arrives.
  const last = messages[messages.length - 1];
  const lastHasText =
    last?.role === "assistant" &&
    last.parts.some((p) => p.type === "text" && p.text.trim().length > 0);
  const showThinking = isStreaming && !lastHasText;

  return (
    <div className="flex flex-col gap-3 p-3">
      {messages.map((m, i) => (
        <AgentMessage
          key={m.id}
          message={m}
          threadId={threadId}
          isLast={i === lastAssistantIndex}
          isStreaming={isStreaming}
        />
      ))}
      {showThinking && <AgentThinking />}
      {errorRow}
    </div>
  );
}
