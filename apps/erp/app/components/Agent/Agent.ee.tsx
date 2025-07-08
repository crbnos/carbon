import { useCarbon } from "@carbon/auth";
import type { ShortcutDefinition } from "@carbon/react";
import {
  Badge,
  Button,
  cn,
  CodeBlock,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ShortcutKey,
  toast,
  useDisclosure,
  useMount,
  useShortcutKeys,
} from "@carbon/react";
import type { LanguageModelV1Prompt } from "ai";
import { Fragment, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuCheck,
  LuChevronDown,
  LuChevronRight,
  LuCircleStop,
  LuRotateCcw,
  LuShoppingCart,
  LuSparkles,
  LuWrench,
} from "react-icons/lu";
import { EmployeeAvatar } from "~/components";
import { useUser } from "~/hooks/useUser";
import { camelCaseToWords } from "~/utils/string";
import SYSTEM_PROMPT from "./system.ee.txt?raw";

const providerMetadata = {
  anthropic: {
    cacheControl: {
      type: "ephemeral",
    },
  },
};

const shortcut: ShortcutDefinition = {
  key: "I",
  modifiers: ["meta"],
};

const getInitialPrompt = (): LanguageModelV1Prompt => [
  {
    role: "system",
    content: SYSTEM_PROMPT,
    providerMetadata,
  },
  {
    role: "system",
    content: `The current date is ${new Date().toDateString()}`,
    providerMetadata,
  },
];

function ChatInput({
  status,
  textareaRef,
  isInitial,
  onSend,
  onStop,
  onClear,
  className,
}: {
  status: "ready" | "submitted" | "streaming" | "error";
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  isInitial: boolean;
  onClear: () => void;
  onSend: (message: string) => void;
  onStop: () => void;
  className?: string;
}) {
  return (
    <div className={cn("p-2", className)}>
      <div className="bg-card rounded-xl md:rounded-lg text-base min-h-20 md:min-h-[60px] border">
        <div className="flex flex-col items-center justify-center w-full">
          <div className="relative w-full">
            <textarea
              ref={textareaRef}
              autoFocus
              disabled={status !== "ready"}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && status === "ready") {
                  onSend(e.currentTarget.value);
                  e.currentTarget.value = "";
                  e.preventDefault();
                }
              }}
              className="w-full py-4 bg-transparent border-none resize-none outline-none text-foreground p-4 md:p-3"
              placeholder={
                status !== "ready" ? "Thinking..." : "What can I help you with?"
              }
            />
            {status !== "ready" && (
              <IconButton
                aria-label="Stop"
                icon={<LuCircleStop />}
                variant="ghost"
                onClick={onStop}
                className="absolute right-2 top-2 rounded-full before:rounded-full before:absolute before:inset-0 before:bg-background"
              />
            )}
          </div>
          <HStack className="w-full justify-between p-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="secondary"
                  rightIcon={<LuChevronDown />}
                >
                  Purchasing Agent{" "}
                  <ShortcutKey variant="small" shortcut={shortcut} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem>
                  <DropdownMenuIcon icon={<LuShoppingCart />} />
                  <span>Purchasing Agent</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {!isInitial && (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<LuRotateCcw />}
                onClick={onClear}
              >
                Clear
              </Button>
            )}
          </HStack>
        </div>
      </div>
    </div>
  );
}

export function Agent() {
  const agentModal = useDisclosure();

  useShortcutKeys({
    shortcut: shortcut,
    action: agentModal.onOpen,
  });

  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const idRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [tools, setTools] = useState<any[]>([]);
  const [status, setStatus] = useState<
    "ready" | "submitted" | "streaming" | "error"
  >("ready");
  const [isRateLimited, setIsRateLimited] = useState(false);

  const messagesRef = useRef<LanguageModelV1Prompt>(getInitialPrompt());
  const [messages, setMessages] = useState<LanguageModelV1Prompt>(
    getInitialPrompt()
  );

  const { carbon } = useCarbon();
  const {
    id: userId,
    company: { id: companyId },
  } = useUser();

  useMount(() => {
    const initializeTools = async () => {
      if (!carbon) return;
      const tools = await carbon.functions.invoke("mcp", {
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: ++idRef.current,
        }),
        headers: {
          "x-company-id": companyId,
          "x-user-id": userId,
        },
      });

      if (!tools?.data?.result) {
        // toast.error("Failed to fetch tools");
        return;
      }

      setTools("tools" in tools?.data?.result ? tools.data.result.tools : []);
    };

    initializeTools();
  });

  useEffect(() => {
    if (rootRef.current) {
      const scrollHeight = rootRef.current.scrollHeight;
      rootRef.current.scrollTo({
        top: scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages]);

  const stop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStatus("ready");
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && status !== "ready") {
        stop();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [status]);

  function clearConversation() {
    const initialPrompt = getInitialPrompt();
    messagesRef.current = initialPrompt;
    setMessages(initialPrompt);
  }

  const addToolResult = async (toolCall: any, content: any) => {
    const newMessage: LanguageModelV1Prompt = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            result: content,
          },
        ],
      },
    ];

    messagesRef.current = [...messagesRef.current, ...newMessage];
    flushSync(() => {
      setMessages(messagesRef.current);
    });

    return triggerRequest();
  };

  const addToolCalls = async (toolCalls: any) => {
    const newMessage: LanguageModelV1Prompt = [
      {
        role: "assistant",
        content: toolCalls.map((item: any) => ({
          type: "tool-call",
          toolName: item.toolName,
          args: JSON.parse(item.args),
          toolCallId: item.toolCallId,
        })),
      },
    ];

    messagesRef.current = [...messagesRef.current, ...newMessage];
    flushSync(() => {
      setMessages(messagesRef.current);
    });
  };

  const triggerRequest = async () => {
    if (!carbon) return;

    try {
      setStatus("submitted");
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const response = await carbon.functions.invoke("chat", {
        headers: {
          "x-company-id": companyId,
          "x-user-id": userId,
        },
        body: JSON.stringify({
          prompt: messagesRef.current,
          mode: {
            type: "regular",
            tools: tools.map((tool) => ({
              type: "function",
              name: tool.name,
              description: tool.description,
              parameters: {
                ...tool.inputSchema,
              },
            })),
          },
          inputFormat: "messages",
          temperature: 1,
        }),
      });

      if (response?.error) {
        throw new Error(response.error);
      }

      const result = response.data;
      setStatus("streaming");

      if (result.text) {
        const newMessage: LanguageModelV1Prompt = [
          {
            role: "assistant",
            content: [
              {
                type: "text",
                text: result.text,
              },
            ],
          },
        ];

        messagesRef.current = [...messagesRef.current, ...newMessage];
        setMessages(messagesRef.current);
      }

      setIsRateLimited(false);

      if (result.finishReason === "tool-calls") {
        for await (const toolCall of result.toolCalls) {
          await addToolCalls(result.toolCalls);

          const toolResponse = await carbon.functions.invoke("mcp", {
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "tools/call",
              id: ++idRef.current,
              params: {
                name: toolCall.toolName,
                arguments: JSON.parse(toolCall.args),
              },
            }),
            headers: {
              "x-company-id": companyId,
              "x-user-id": userId,
            },
          });

          const response = toolResponse?.data;

          if ("content" in response?.result) {
            await addToolResult(toolCall, response.result.content);
          }
        }
      }

      setStatus("ready");
      textareaRef.current?.focus();
    } catch (error) {
      console.error(error);
      setStatus("error");
      toast.error("An error occurred");
    } finally {
      abortControllerRef.current = null;
    }
  };

  async function send(message: string) {
    const newMessage: LanguageModelV1Prompt = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: message,
            providerMetadata:
              messagesRef.current.length === 1 ? providerMetadata : {},
          },
        ],
      },
    ];

    messagesRef.current = [...messagesRef.current, ...newMessage];

    flushSync(() => {
      setMessages(messagesRef.current);
      setStatus("submitted");
    });

    await triggerRequest();
  }

  const isInitialState = messages.length === 2;

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) {
          agentModal.onClose();
        } else {
          agentModal.onOpen();
        }
      }}
      open={agentModal.isOpen}
    >
      <PopoverTrigger asChild>
        <IconButton variant="ghost" icon={<LuSparkles />} aria-label="Agent" />
      </PopoverTrigger>
      <PopoverContent
        className="h-[calc(100vh-52px)] w-screen md:w-[480px] p-0 overflow-hidden flex flex-col"
        align="center"
        sideOffset={10}
      >
        {isInitialState && (
          <ChatInput
            status={status}
            textareaRef={textareaRef}
            isInitial={messages.length === 2}
            onClear={clearConversation}
            onSend={send}
            onStop={stop}
          />
        )}

        <div ref={rootRef} className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-y-4">
            {messages.map((item, index) => (
              <Fragment key={index}>
                {item.role === "user" && item.content[0].type === "text" && (
                  <div className="flex items-center gap-x-2 bg-card p-3 rounded-lg bg-card border ">
                    <div className="h-8 w-8 rounded-full flex items-center justify-center">
                      <EmployeeAvatar employeeId={userId} withName={false} />
                    </div>
                    <div className="whitespace-pre-wrap flex-1">
                      {item.content[0].text}
                    </div>
                  </div>
                )}

                {item.role === "assistant" &&
                  item.content[0].type === "tool-call" && (
                    <ToolExecution
                      toolCall={item.content[0]}
                      result={
                        messages[index + 1]?.role === "tool"
                          ? messages[index + 1].content[0]
                          : undefined
                      }
                    />
                  )}

                {item.role === "assistant" &&
                  item.content[0].type === "text" && (
                    <div className="whitespace-pre-wrap text-foreground px-1">
                      {item.content[0].text}
                    </div>
                  )}

                {item.role === "system" && index > 1 && (
                  <div className="whitespace-pre-wrap p-3 rounded-lg border italic opacity-80">
                    {item.content}
                  </div>
                )}
              </Fragment>
            ))}

            {status !== "ready" && (
              <div className="w-full max-w-[480px] my-3  flex items-center mx-auto">
                <div className="w-[18px] h-[18px] mr-3 relative">
                  <div className="absolute w-full h-full rounded-full border-2 border-transparent border-t-muted-foreground border-b-muted animate-[thinking-spin-outer_1.5s_cubic-bezier(0.6,0.2,0.4,0.8)_infinite]">
                    <div className="absolute inset-[2px] rounded-full border-2 border-transparent border-l-muted border-r-muted-foreground animate-[thinking-spin-inner_0.8s_cubic-bezier(0.3,0.7,0.7,0.3)_infinite]"></div>
                  </div>
                </div>
                <div className="text-muted-foreground">
                  {isRateLimited ? "Rate limited, retrying..." : "Thinking"}
                </div>
              </div>
            )}
          </div>
        </div>

        {!isInitialState && (
          <ChatInput
            status={status}
            textareaRef={textareaRef}
            isInitial={messages.length === 2}
            onClear={clearConversation}
            onSend={send}
            onStop={stop}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function ToolExecution({ toolCall, result }: { toolCall: any; result?: any }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-card hover:bg-card/80 p-3 rounded-lg border">
      <div
        className="flex justify-between items-center h-9 md:h-8 w-full relative cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
      >
        <div className="flex items-center gap-1">
          <Badge variant="secondary" className="font-mono ml-1">
            <LuWrench className="mr-1" />
            {camelCaseToWords(toolCall.toolName)}
          </Badge>
          {result && <LuCheck className="text-emerald-500" />}
        </div>
        <LuChevronRight
          className={cn(
            "transition-transform duration-200",
            isExpanded ? "rotate-90" : "rotate-0"
          )}
        />
      </div>
      {isExpanded && (
        <div className="mt-4 p-2 md:p-1.5">
          <div className="mb-2 text-sm text-muted-foreground">Parameters:</div>
          <CodeBlock
            className="language-json"
            parentClassName="max-h-[300px] md:max-h-[200px] overflow-y-auto"
          >
            {JSON.stringify(toolCall.args, null, 2)}
          </CodeBlock>

          {result && (
            <>
              <div className="mt-3 mb-2 text-sm text-muted-foreground">
                Result:
              </div>
              <CodeBlock
                className="language-json"
                parentClassName="max-h-[300px] md:max-h-[200px] overflow-y-auto"
              >
                {JSON.stringify(
                  result?.result?.[0]?.text
                    ? JSON.parse(result.result[0].text)
                    : result,
                  null,
                  2
                )}
              </CodeBlock>
            </>
          )}
        </div>
      )}
    </div>
  );
}
