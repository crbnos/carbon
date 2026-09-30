import type { UIMessage } from "ai";

// Sliding window: send the model only the most recent messages whose combined size stays
// under this character budget (a rough token proxy — ~4 chars/token), dropping the oldest.
export const HISTORY_CHAR_BUDGET = 100_000; // ~25k tokens of history

/** A stored `agentMessage` row with its parts, as `getMessages` returns it. */
export type StoredMessage = {
  id: string;
  role: string;
  parts?: Array<{
    orderIndex: number;
    type: string;
    textContent: string | null;
  }> | null;
};

const messageText = (m: UIMessage) =>
  m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

export function windowByChars(
  messages: UIMessage[],
  budget: number
): UIMessage[] {
  const kept: UIMessage[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const size = messageText(messages[i]!).length;
    // Always keep the most recent message, even if it alone exceeds the budget.
    if (kept.length > 0 && total + size > budget) break;
    kept.unshift(messages[i]!);
    total += size;
  }
  // Anthropic requires the first message to be a user message; dropping the oldest
  // turns can leave an assistant at the front, so trim any leading non-user messages.
  while (kept.length > 1 && kept[0]!.role !== "user") kept.shift();
  return kept;
}

/**
 * The conversation as the model sees it, built from the stored thread — never from the
 * browser. Only user and assistant TEXT is kept: earlier tool calls and results are
 * dropped (the answers already carry what they found, and the model can search again),
 * which also keeps every later request small. A question whose turn failed has no answer
 * after it; it is dropped unless it is the question being answered now, so the model
 * never sees two questions in a row.
 */
export function buildModelHistory(
  rows: StoredMessage[],
  budget = HISTORY_CHAR_BUDGET
): UIMessage[] {
  const messages = rows.flatMap((row): UIMessage[] => {
    if (row.role !== "user" && row.role !== "assistant") return [];
    const text = (row.parts ?? [])
      .filter((p) => p.type === "text" && p.textContent)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((p) => p.textContent)
      .join("\n\n")
      .trim();
    return text
      ? [{ id: row.id, role: row.role, parts: [{ type: "text", text }] }]
      : [];
  });
  const answeredOrCurrent = messages.filter(
    (m, i) =>
      m.role !== "user" ||
      i === messages.length - 1 ||
      messages[i + 1]?.role === "assistant"
  );
  return windowByChars(answeredOrCurrent, budget);
}
