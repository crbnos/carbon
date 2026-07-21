import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import posthog from "posthog-js";
import { useEffect, useMemo, useRef } from "react";
import { useAgentStore } from "~/stores/agent";
import { path } from "~/utils/path";
import { isUiBlockTool } from "../agent.blocks";
import { useBrowsingContext } from "./useBrowsingContext";

// Persisted rows as returned by the thread-history endpoint.
type DbPart = {
  orderIndex: number;
  type: string;
  textContent: string | null;
  toolName: string | null;
  toolCallId: string | null;
  toolInput: unknown;
  toolOutput: unknown;
};
type DbMessage = { id: string; role: string; parts?: DbPart[] };

// Rebuild persisted rows into the AI SDK's UIMessage shape for history replay.
// Only text and UI-block tool parts are reconstructed — read-tool step lines are
// transient and not replayed. The SDK types tool parts as `tool-${name}` template
// literals we can't express statically, so the DB→UIMessage mapping is asserted
// once here, at this single boundary, instead of leaking casts into callers.
function reconstructMessages(dbMessages: DbMessage[]): UIMessage[] {
  return dbMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id,
      role: m.role,
      parts: (m.parts ?? [])
        .slice()
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .flatMap((p): Record<string, unknown>[] => {
          if (p.type === "text" && p.textContent) {
            return [{ type: "text", text: p.textContent }];
          }
          if (p.type === "tool" && p.toolName && isUiBlockTool(p.toolName)) {
            return [
              {
                type: `tool-${p.toolName}`,
                toolCallId: p.toolCallId ?? `hist-${p.orderIndex}`,
                state: "output-available",
                input: p.toolInput,
                output: p.toolOutput
              }
            ];
          }
          return [];
        })
    }))
    .filter((m) => m.parts.length > 0) as unknown as UIMessage[];
}

/**
 * Owns the agent's chat transport and thread lifecycle (send / load / reset),
 * so AgentPanel stays presentational. Sends are serialized to one turn at a time
 * and thread pre-creation is deduped, so neither the input nor a block action can
 * stack turns or spawn duplicate threads.
 */
export function useAgentThread() {
  const threadId = useAgentStore((s) => s.threadId);
  const setThread = useAgentStore((s) => s.setThread);
  const context = useBrowsingContext();

  // Refs so the transport closure and the send guard always read the latest values.
  const threadIdRef = useRef<string | null>(threadId);
  threadIdRef.current = threadId;
  const contextRef = useRef<typeof context | null>(context);
  contextRef.current = context;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: path.to.api.agentChat,
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            messages,
            threadId: threadIdRef.current,
            context: contextRef.current
          }
        })
      }),
    []
  );

  const { messages, sendMessage, setMessages, status, stop, error } = useChat({
    transport
  });

  const isStreaming = status === "streaming" || status === "submitted";
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

  // Fire agent_stream_completed when a streaming turn returns to idle.
  const prevStatus = useRef(status);
  useEffect(() => {
    if (
      (prevStatus.current === "streaming" ||
        prevStatus.current === "submitted") &&
      status === "ready"
    ) {
      posthog.capture("agent_stream_completed", {
        messageCount: messages.length
      });
    }
    prevStatus.current = status;
  }, [status, messages.length]);

  // Pre-create the thread so the server and client agree on its id. Concurrent
  // callers (e.g. a burst of block clicks) share one in-flight request so we never
  // spawn duplicate threads.
  const createInFlight = useRef<Promise<string | null> | null>(null);
  function ensureThread(): Promise<string | null> {
    if (threadIdRef.current) return Promise.resolve(threadIdRef.current);
    if (!createInFlight.current) {
      createInFlight.current = fetch(path.to.api.agentThreads, {
        method: "POST",
        body: new FormData()
      })
        .then((res) => res.json() as Promise<{ threadId?: string }>)
        .then((data) => {
          const id = data.threadId ?? null;
          if (id) {
            threadIdRef.current = id;
            setThread(id);
          }
          return id;
        })
        .finally(() => {
          createInFlight.current = null;
        });
    }
    return createInFlight.current;
  }

  async function send(text: string) {
    // One turn at a time: ignore sends (from the input or a block action) mid-stream.
    if (isStreamingRef.current) return;
    posthog.capture("agent_message_sent", { hasContext: !!contextRef.current });
    await ensureThread();
    sendMessage({ text });
  }

  async function loadThread(id: string) {
    setThread(id);
    threadIdRef.current = id;
    const res = await fetch(path.to.api.agentThread(id));
    const data = (await res.json()) as { messages?: DbMessage[] };
    setMessages(reconstructMessages(data.messages ?? []));
  }

  // Reset in place (no navigation) so the panel never flickers closed.
  function newThread() {
    setMessages([]);
    setThread(null);
    threadIdRef.current = null;
  }

  return {
    messages,
    error,
    isStreaming,
    send,
    stop,
    loadThread,
    newThread,
    // Escape hatch for the dev-only block viewer; not for feature code.
    setMessages
  };
}
