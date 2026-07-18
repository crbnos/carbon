import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { AgentFeedback } from "./AgentFeedback";
import { AgentTextPart } from "./AgentTextPart";

const RUNNING_LABEL: Record<string, string> = {
  search_docs: "Searching the docs",
  read_doc: "Reading a doc",
  search_tools: "Finding the right tool",
  describe_tool: "Inspecting a tool",
  call_tool: "Looking up data"
};
const DONE_LABEL: Record<string, string> = {
  search_docs: "Searched the docs",
  read_doc: "Read a doc",
  search_tools: "Found a tool",
  describe_tool: "Inspected a tool",
  call_tool: "Looked up data"
};

// Plain, quiet italic line per tool call — no box, no icon.
function AgentToolStep({ name, state }: { name: string; state: string }) {
  const done = state === "output-available" || state === "output-error";
  const text = done
    ? (DONE_LABEL[name] ?? name)
    : `${RUNNING_LABEL[name] ?? name}…`;
  return (
    <div className="my-0.5 text-xs italic text-muted-foreground">{text}</div>
  );
}

export function AgentMessage({
  message,
  threadId,
  isLast,
  isStreaming
}: {
  message: UIMessage;
  threadId: string | null;
  isLast: boolean;
  isStreaming: boolean;
}) {
  const isUser = message.role === "user";
  return (
    <div className={isUser ? "self-end max-w-[85%]" : "self-start w-full"}>
      <div
        className={
          isUser
            ? "rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm"
            : "text-sm text-foreground"
        }
      >
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return <AgentTextPart key={i} text={part.text} isUser={isUser} />;
          }
          if (isToolUIPart(part)) {
            return (
              <AgentToolStep
                key={i}
                name={getToolName(part)}
                state={part.state}
              />
            );
          }
          return null;
        })}
      </div>
      {!isUser && isLast && !isStreaming && threadId && (
        <AgentFeedback threadId={threadId} />
      )}
    </div>
  );
}
