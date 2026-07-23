import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { AgentFeedback } from "./AgentFeedback";
import { AgentTextPart } from "./AgentTextPart";
import { AgentBlockButton } from "./blocks/AgentBlockButton";
import { AgentBlockChoice } from "./blocks/AgentBlockChoice";
import { AgentBlockLink } from "./blocks/AgentBlockLink";
import { AgentNavigate } from "./blocks/AgentNavigate";

const RUNNING_LABEL: Record<string, string> = {
  search_docs: "Searching the docs",
  read_doc: "Reading a doc",
  search_tools: "Finding the right tool",
  describe_tool: "Inspecting a tool",
  call_tool: "Looking up data",
  find_page: "Finding the page"
};
const DONE_LABEL: Record<string, string> = {
  search_docs: "Searched the docs",
  read_doc: "Read a doc",
  search_tools: "Found a tool",
  describe_tool: "Inspected a tool",
  call_tool: "Looked up data",
  find_page: "Found the page"
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
    <div
      className={isUser ? "self-end max-w-[85%]" : "self-start w-full min-w-0"}
    >
      <div
        className={
          isUser
            ? "rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm"
            : "text-sm text-foreground"
        }
      >
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return (
              <AgentTextPart
                key={part.type + i}
                text={part.text}
                isUser={isUser}
              />
            );
          }
          // UI-block tools → rich blocks (rendered from part.input):
          if (part.type === "tool-present_choice") {
            return <AgentBlockChoice key={part.type + i} input={part.input} />;
          }
          // Wrap in a block so multiple blocks stack vertically (inline <a>/button
          // would otherwise flow onto the same row).
          if (part.type === "tool-present_link") {
            return (
              <div key={part.type + i} className="my-1">
                <AgentBlockLink input={part.input} />
              </div>
            );
          }
          if (part.type === "tool-present_button") {
            return (
              <div key={part.type + i} className="my-1">
                <AgentBlockButton input={part.input} />
              </div>
            );
          }
          if (part.type === "tool-navigate") {
            return (
              <AgentNavigate
                key={part.type + i}
                input={part.input}
                state={part.state}
                toolCallId={part.toolCallId}
              />
            );
          }
          // Read tools → the quiet italic step line:
          if (isToolUIPart(part)) {
            return (
              <AgentToolStep
                key={part.type + i}
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
