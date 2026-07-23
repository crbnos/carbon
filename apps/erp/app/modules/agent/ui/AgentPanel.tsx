import {
  Badge,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import posthog from "posthog-js";
import { useEffect, useState } from "react";
import { LuArrowDown, LuHistory, LuPlus, LuX } from "react-icons/lu";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { useAgentStore } from "~/stores/agent";
import { useAgentThread } from "../hooks/useAgentThread";
import { AgentActionsProvider } from "./AgentActionsContext";
import { AgentInput } from "./AgentInput";
import { AgentMessageList } from "./AgentMessageList";
import { AgentThreadList } from "./AgentThreadList";
import { AgentBlockViewer } from "./dev/AgentBlockViewer";

// Floating "scroll to bottom" affordance — only shown when the user has
// scrolled up. Must live inside <StickToBottom> to read its context.
function ScrollToBottomButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  if (isAtBottom) return null;

  return (
    <div className="sticky bottom-0 left-0 flex justify-center pointer-events-none">
      <IconButton
        aria-label="Scroll to bottom"
        icon={<LuArrowDown />}
        variant="secondary"
        size="sm"
        onClick={() => scrollToBottom()}
        className="pointer-events-auto mb-3 rounded-full shadow-md border animate-in fade-in zoom-in-95 duration-150"
      />
    </div>
  );
}

export function AgentPanel() {
  const closeAgent = useAgentStore((s) => s.closeAgent);
  const threadId = useAgentStore((s) => s.threadId);
  const [showHistory, setShowHistory] = useState(false);

  const {
    messages,
    error,
    isStreaming,
    send,
    stop,
    loadThread,
    newThread,
    setMessages
  } = useAgentThread();

  useEffect(() => {
    posthog.capture("agent_opened");
  }, []);

  const expanded = messages.length > 0;

  return (
    <div
      className={`fixed right-4 z-40 flex flex-col w-100 max-w-[calc(100vw-2rem)] rounded-xl border bg-background shadow-lg overflow-hidden animate-in slide-in-from-top-4 fade-in duration-200 ${
        expanded ? "top-14 bottom-4" : "top-14 h-[45vh]"
      }`}
    >
      <div className="flex items-center justify-between px-3 h-11 border-b shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Ask a question</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="blue" className="cursor-default">
                Beta
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              This assistant is in beta and constantly improving — answers may
              be incomplete.
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-1">
          <AgentBlockViewer setMessages={setMessages} />
          <IconButton
            aria-label="New chat"
            icon={<LuPlus />}
            variant="ghost"
            size="sm"
            isDisabled={messages.length === 0}
            onClick={() => {
              newThread();
              setShowHistory(false);
            }}
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
              <AgentThreadList
                onSelect={(id) => {
                  setShowHistory(false);
                  loadThread(id);
                }}
                onDelete={(id) => {
                  if (id === threadId) newThread();
                }}
              />
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

      <AgentActionsProvider value={{ sendMessage: (text) => void send(text) }}>
        <StickToBottom
          className="relative flex-1 overflow-y-auto"
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
          <ScrollToBottomButton />
        </StickToBottom>
      </AgentActionsProvider>
      <div className="p-3 shrink-0">
        <AgentInput
          disabled={isStreaming}
          isStreaming={isStreaming}
          onSend={send}
          onStop={stop}
        />
      </div>
    </div>
  );
}
