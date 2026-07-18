import { useChat } from "@ai-sdk/react";
import {
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@carbon/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import posthog from "posthog-js";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuHistory, LuPlus, LuX } from "react-icons/lu";
import { StickToBottom } from "use-stick-to-bottom";
import { useAgentStore } from "~/stores/agent";
import { path } from "~/utils/path";
import { isUiBlockTool } from "../agent.blocks";
import { useBrowsingContext } from "../hooks/useBrowsingContext";
import { AgentActionsProvider } from "./AgentActionsContext";
import { AgentInput } from "./AgentInput";
import { AgentMessageList } from "./AgentMessageList";
import { AgentThreadList } from "./AgentThreadList";
import { AgentBlockViewer } from "./dev/AgentBlockViewer";

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

export function AgentPanel() {
  const closeAgent = useAgentStore((s) => s.closeAgent);
  const threadId = useAgentStore((s) => s.threadId);
  const setThread = useAgentStore((s) => s.setThread);

  // Sent with every turn so the agent can resolve "this record" — background only,
  // not surfaced in the UI.
  const context = useBrowsingContext();
  const [showHistory, setShowHistory] = useState(false);

  // Refs so the transport closure always reads the latest values.
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

  useEffect(() => {
    posthog.capture("agent_opened");
  }, []);

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

  async function handleSend(text: string) {
    posthog.capture("agent_message_sent", {
      hasContext: !!contextRef.current
    });
    // Pre-create the thread so the server and client agree on its id.
    if (!threadIdRef.current) {
      const res = await fetch(path.to.api.agentThreads, {
        method: "POST",
        body: new FormData()
      });
      const data = (await res.json()) as { threadId?: string };
      if (data.threadId) {
        threadIdRef.current = data.threadId;
        setThread(data.threadId);
      }
    }
    sendMessage({ text });
  }

  // No navigation — just reset in place so the panel never flickers closed.
  function handleNewThread() {
    setMessages([]);
    setThread(null);
    threadIdRef.current = null;
    setShowHistory(false);
  }

  async function loadThread(id: string) {
    setShowHistory(false);
    setThread(id);
    threadIdRef.current = id;
    const res = await fetch(path.to.api.agentThread(id));
    const data = (await res.json()) as { messages?: DbMessage[] };
    const ui = (data.messages ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        parts: (m.parts ?? [])
          .slice()
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map((p) => {
            if (p.type === "text" && p.textContent) {
              return { type: "text", text: p.textContent };
            }
            // Rebuild UI-block tool parts so blocks show (inert) in history.
            if (p.type === "tool" && p.toolName && isUiBlockTool(p.toolName)) {
              return {
                type: `tool-${p.toolName}`,
                toolCallId: p.toolCallId ?? `hist-${p.orderIndex}`,
                state: "output-available",
                input: p.toolInput,
                output: p.toolOutput
              };
            }
            return null;
          })
          .filter(Boolean)
      }))
      .filter((m) => m.parts.length > 0);
    setMessages(ui as unknown as UIMessage[]);
  }

  const isStreaming = status === "streaming" || status === "submitted";
  const expanded = messages.length > 0;

  return (
    <div
      className={`fixed right-4 z-40 flex flex-col w-[400px] max-w-[calc(100vw-2rem)] rounded-xl border bg-background shadow-lg overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200 ${
        expanded ? "top-4 bottom-4" : "bottom-4 h-[45vh]"
      }`}
    >
      <div className="flex items-center justify-between px-3 h-11 border-b shrink-0">
        <span className="text-sm font-semibold">Carbon Agent</span>
        <div className="flex items-center gap-1">
          <AgentBlockViewer setMessages={setMessages} />
          <IconButton
            aria-label="New chat"
            icon={<LuPlus />}
            variant="ghost"
            size="sm"
            isDisabled={messages.length === 0}
            onClick={handleNewThread}
          />
          <Popover open={showHistory} onOpenChange={setShowHistory}>
            <PopoverTrigger asChild>
              <IconButton
                aria-label="History"
                icon={<LuHistory />}
                variant="ghost"
                size="sm"
              />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-0">
              <AgentThreadList onSelect={loadThread} />
            </PopoverContent>
          </Popover>
          <IconButton
            aria-label="Close"
            icon={<LuX />}
            variant="ghost"
            size="sm"
            onClick={() => closeAgent()}
          />
        </div>
      </div>

      <AgentActionsProvider
        value={{ sendMessage: (text) => void handleSend(text) }}
      >
        <StickToBottom
          className="flex-1 overflow-y-auto"
          resize="smooth"
          initial="smooth"
        >
          <StickToBottom.Content>
            <AgentMessageList
              messages={messages}
              threadId={threadId}
              error={error}
              isStreaming={isStreaming}
            />
          </StickToBottom.Content>
        </StickToBottom>
      </AgentActionsProvider>
      <div className="p-3 shrink-0">
        <AgentInput
          disabled={isStreaming}
          isStreaming={isStreaming}
          onSend={handleSend}
          onStop={stop}
        />
      </div>
    </div>
  );
}
