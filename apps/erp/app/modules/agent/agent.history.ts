// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { choiceBlock, isEphemeralTool, isUiBlockTool } from "./agent.blocks";

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
    toolName?: string | null;
    toolCallId?: string | null;
    toolInput?: unknown;
    toolOutput?: unknown;
  }> | null;
};

type Role = "user" | "assistant";
const isChatRole = (role: string): role is Role =>
  role === "user" || role === "assistant";

const sortedParts = (row: StoredMessage) =>
  (row.parts ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex);

// A choice the answer offered, as text: the user's pick arrives as the next question, and
// without the options the model cannot tell what it was picked from.
function choiceAsText(input: unknown): string | null {
  const parsed = choiceBlock.safeParse(input);
  if (!parsed.success) return null;
  const { prompt, options } = parsed.data;
  const offered = options
    .map((o) => (o.label === o.value ? o.label : `${o.label} (${o.value})`))
    .join("; ");
  return `${prompt ? `${prompt}\n` : ""}[Choices offered: ${offered}]`;
}

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
 * browser. Only user and assistant TEXT is kept, plus any choice an answer offered (as
 * text): earlier tool calls and results are dropped (the answers already carry what they
 * found, and the model can search again), which also keeps every later request small. A
 * question whose turn failed has no answer
 * after it; it is dropped unless it is the question being answered now, so the model
 * never sees two questions in a row.
 */
export function buildModelHistory(
  rows: StoredMessage[],
  budget = HISTORY_CHAR_BUDGET
): UIMessage[] {
  const messages = rows.flatMap((row): UIMessage[] => {
    if (!isChatRole(row.role)) return [];
    const text = sortedParts(row)
      .flatMap((p): string[] => {
        if (p.type === "text" && p.textContent) return [p.textContent];
        const choice =
          p.type === "tool" && p.toolName === "present_choice"
            ? choiceAsText(p.toolInput)
            : null;
        return choice ? [choice] : [];
      })
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

/**
 * The conversation as the panel shows it when a thread is reopened: text, plus the UI
 * blocks (choices, links, buttons) the answers carried. Read-tool steps are not replayed.
 */
export function toDisplayMessages(rows: StoredMessage[]): UIMessage[] {
  return rows.flatMap((row): UIMessage[] => {
    if (!isChatRole(row.role)) return [];
    const parts = sortedParts(row).flatMap((p): UIMessage["parts"] => {
      if (p.type === "text" && p.textContent) {
        return [{ type: "text", text: p.textContent }];
      }
      if (p.type === "tool" && p.toolName && isUiBlockTool(p.toolName)) {
        return [
          {
            type: `tool-${p.toolName}`,
            toolCallId: p.toolCallId ?? `${row.id}-${p.orderIndex}`,
            state: "output-available",
            input: p.toolInput,
            output: p.toolOutput
          }
        ];
      }
      return [];
    });
    return parts.length > 0 ? [{ id: row.id, role: row.role, parts }] : [];
  });
}

export type StoredPart = Omit<
  Database["public"]["Tables"]["agentMessagePart"]["Insert"],
  "messageId" | "companyId" | "orderIndex" | "createdBy"
>;

const DOC_TOOLS = new Set(["search_docs", "read_doc"]);

/** The parts of an answer worth keeping: text, and tool calls that completed. */
export function toStoredParts(message: UIMessage): StoredPart[] {
  return message.parts.flatMap((part): StoredPart[] => {
    if (part.type === "text") {
      return part.text ? [{ type: "text", textContent: part.text }] : [];
    }
    if (!isToolUIPart(part)) return [];
    const name = getToolName(part);
    // Ephemeral tools (navigate) are never replayed; a call cut off by Stop has no result.
    if (isEphemeralTool(name)) return [];
    if (part.state !== "output-available" && part.state !== "output-error") {
      return [];
    }
    return [
      {
        type: "tool",
        toolName: name,
        toolClassification: isUiBlockTool(name)
          ? null
          : DOC_TOOLS.has(name)
            ? "DOCS"
            : "READ",
        toolCallId: part.toolCallId,
        toolInput: JSON.stringify(part.input ?? null),
        toolOutput: JSON.stringify(
          part.state === "output-error"
            ? { error: part.errorText }
            : (part.output ?? null)
        ),
        toolState: part.state === "output-available" ? "success" : "error"
      }
    ];
  });
}
