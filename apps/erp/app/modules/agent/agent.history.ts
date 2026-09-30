import { getToolName, isToolUIPart, type UIMessage } from "ai";

// Sliding window: send the model only the most recent messages whose combined size stays
// under this character budget (a rough token proxy — ~4 chars/token), dropping the oldest.
// Keeps the conversation from growing unbounded toward the context window. Whole messages
// are kept/dropped so tool-call/result pairs stay intact.
export const HISTORY_CHAR_BUDGET = 100_000; // ~25k tokens of history

function messageSize(m: UIMessage): number {
  let n = 0;
  for (const part of m.parts) {
    if (part.type === "text") n += part.text.length;
    else if (isToolUIPart(part)) {
      n +=
        JSON.stringify(part.input ?? "").length +
        JSON.stringify(part.output ?? "").length;
    }
  }
  return n;
}

// Doc tool results from earlier turns are re-sent with every later request. Keep what the
// model needs to recall them (titles and urls) and drop the text; it can read_doc again.
function compactToolOutput(toolName: string, output: unknown): unknown {
  if (toolName === "read_doc" && output && typeof output === "object") {
    const { url } = output as { url?: string };
    return url
      ? { url, note: "Read in an earlier turn; read_doc again for the text." }
      : output;
  }
  if (toolName === "search_docs" && Array.isArray(output)) {
    // A tool result must be a JSON value: an intro hit has no section, and a key set to
    // `undefined` fails the SDK's prompt validation for the whole request.
    return output.map(({ title, section, url }) => ({
      title,
      url,
      ...(section ? { section } : {})
    }));
  }
  return output;
}

export function compactEarlierToolOutputs(messages: UIMessage[]): UIMessage[] {
  const lastUser = messages.findLastIndex((m) => m.role === "user");
  return messages.map((message, i) =>
    i >= lastUser
      ? message
      : {
          ...message,
          parts: message.parts.map((part) =>
            isToolUIPart(part) && part.state === "output-available"
              ? {
                  ...part,
                  output: compactToolOutput(getToolName(part), part.output)
                }
              : part
          )
        }
  );
}

export function windowByChars(
  messages: UIMessage[],
  budget: number
): UIMessage[] {
  const kept: UIMessage[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const size = messageSize(messages[i]);
    // Always keep the most recent message, even if it alone exceeds the budget.
    if (kept.length > 0 && total + size > budget) break;
    kept.unshift(messages[i]);
    total += size;
  }
  // Anthropic requires the first message to be a user message; dropping the oldest
  // turns can leave an assistant at the front, so trim any leading non-user messages.
  while (kept.length > 1 && kept[0].role !== "user") kept.shift();
  return kept;
}
