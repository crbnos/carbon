import type { UIMessage } from "ai";
import { AgentGreeting } from "./AgentGreeting";
import { AgentMessage } from "./AgentMessage";
import { AgentThinking } from "./AgentThinking";

export function AgentMessageList({
  messages,
  threadId,
  error,
  isStreaming
}: {
  messages: UIMessage[];
  threadId: string | null;
  error?: Error;
  isStreaming: boolean;
}) {
  if (messages.length === 0) {
    return <AgentGreeting />;
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
      {error && (
        <div className="text-sm text-destructive">
          Something went wrong. Please try again.
        </div>
      )}
    </div>
  );
}
