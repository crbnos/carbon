import { useCarbon } from "@carbon/auth";
import { Badge, Button, cn, CodeBlock, toast, useMount } from "@carbon/react";
import type { LanguageModelV1Prompt } from "ai";
import { Fragment, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useUser } from "~/hooks/useUser";
import SYSTEM_PROMPT from "./system.txt?raw";
import { LuCheck, LuChevronRight, LuWrench } from "react-icons/lu";
import { camelCaseToWords } from "~/utils/string";
import { EmployeeAvatar } from "~/components";

const providerMetadata = {
  anthropic: {
    cacheControl: {
      type: "ephemeral",
    },
  },
};

// Define initial system messages once
const getInitialPrompt = (): LanguageModelV1Prompt => [
  {
    role: "system",
    content: SYSTEM_PROMPT,
    providerMetadata: {
      anthropic: {
        cacheControl: {
          type: "ephemeral",
        },
      },
    },
  },
  {
    role: "system",
    content: `The current date is ${new Date().toDateString()}`,
    providerMetadata: {
      anthropic: {
        cacheControl: {
          type: "ephemeral",
        },
      },
    },
  },
];

export default function ChatRoute() {
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const idRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [tools, setTools] = useState<any[]>([]);
  const [status, setStatus] = useState<'ready' | 'submitted' | 'streaming' | 'error'>('ready');
  const [isRateLimited, setIsRateLimited] = useState(false);

  const messagesRef = useRef<LanguageModelV1Prompt>(getInitialPrompt());
  const [messages, setMessages] = useState<LanguageModelV1Prompt>(getInitialPrompt());

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
        toast.error("Failed to fetch tools");
        return;
      }

      setTools("tools" in tools?.data?.result ? tools.data.result.tools : []);
    };

    initializeTools();
  });

  useEffect(() => {
    if (rootRef.current) {
      rootRef.current.scrollTo(0, rootRef.current.scrollHeight);
    }
  }, [messages]);


  const stop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStatus('ready');
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && status !== 'ready') {
        stop();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
    
  }, [status, stop]);

  function clearConversation() {
    const initialPrompt = getInitialPrompt();
    messagesRef.current = initialPrompt;
    setMessages(initialPrompt);
  }

  const addToolResult = async (toolCall: any, content: any) => {
    const newMessage: LanguageModelV1Prompt = [{
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          result: content,
        },
      ],
    }];

    messagesRef.current = [...messagesRef.current, ...newMessage];
    flushSync(() => {
      setMessages(messagesRef.current);
    });

    return triggerRequest();
  };

  const addToolCalls = async (toolCalls: any) => {
    const newMessage: LanguageModelV1Prompt = [{
      role: "assistant",
      content: toolCalls.map((item: any) => ({
        type: "tool-call",
        toolName: item.toolName,
        args: JSON.parse(item.args),
        toolCallId: item.toolCallId,
      })),
    }];

    messagesRef.current = [...messagesRef.current, ...newMessage];
    flushSync(() => {
      setMessages(messagesRef.current);
    });
  };
  

  const triggerRequest = async () => {
    if (!carbon) return;

    try {
      setStatus('submitted');
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
      setStatus('streaming');

      
      if (result.text) {
        const newMessage: LanguageModelV1Prompt = [{
          role: "assistant",
          content: [
            {
              type: "text",
              text: result.text,
            },
          ],
        }];

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

      setStatus('ready');
      textareaRef.current?.focus();

    } catch (error) {
      console.error(error);
      setStatus('error');
      toast.error("An error occurred");
    } finally {
      abortControllerRef.current = null;
    }
  }

  useEffect(() => {
    console.log({messages});
  }, [messages]);

  useEffect(() => {
    console.log({status});
  }, [status]);

  async function send(message: string) {
    const newMessage: LanguageModelV1Prompt = [{
      role: "user",
      content: [
        {
          type: "text",
          text: message,
          providerMetadata: messagesRef.current.length === 1 ? providerMetadata : {},
        },
      ],
    }];

    messagesRef.current = [...messagesRef.current, ...newMessage];
    
    flushSync(() => {
      setMessages(messagesRef.current);
      setStatus('submitted');
    });

    await triggerRequest();
  }

  return (
    <div className="absolute inset-0 overflow-y-auto" ref={rootRef}>
      <div className="flex flex-col gap-y-4 pt-5 w-full max-w-[480px] overflow-hidden text-base mx-auto">
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

            {item.role === "assistant" && item.content[0].type === "tool-call" && (
              <ToolExecution 
                toolCall={item.content[0]} 
                result={messages[index + 1]?.role === "tool" ? messages[index + 1].content[0] : undefined}
              />
            )}

            {item.role === "assistant" && item.content[0].type === "text" && (
              <div className="whitespace-pre-wrap text-foreground px-1">
                {item.content[0].text}
              </div>
            )}

            {item.role === "system" && index > 1 && (
              <div className="whitespace-pre-wrap p-3 rounded bg-secondary border-l-[3px] border-l-muted italic opacity-80">
                {item.content}
              </div>
            )}
          </Fragment>
        ))}

        {status !== 'ready' && (
          <div className="w-full max-w-[480px] my-3 bg-secondary border-l-[3px] border-l-muted flex items-center mx-auto">
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

        <div className="h-[400px] md:h-[200px]"></div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center px-4 pb-4 md:pb-2">
        {messages.length > 2 && status === 'ready' && (
          <div className="relative w-full max-w-[480px] flex justify-end mb-2 md:mb-1">
            <Button onClick={clearConversation} variant="secondary">
              Clear
            </Button>
          </div>
        )}
        <div className="w-full max-w-[480px] bg-card rounded-xl md:rounded-lg text-base h-20 md:h-[60px] border-t border-[oklch(0_0_0/0.25)] border-b border-b-[oklch(1_0_0/0.08)]">
          <textarea
            autoFocus
            ref={textareaRef}
            disabled={status !== 'ready'}
            onKeyDown={(e) => {
              if (e.key === "Enter" && status === 'ready') {
                send(e.currentTarget.value);
                e.currentTarget.value = "";
                e.preventDefault();
              }
            }}
            className="w-full h-full bg-transparent border-none resize-none outline-none text-foreground p-4 md:p-3"
            placeholder={
              status !== 'ready'
                ? "Processing... (Press Esc to cancel)"
                : "Type your message here"
            }
          />
        </div>
      </div>
    </div>
  );
}

function ToolExecution({ toolCall, result }: { toolCall: any, result?: any }) {
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
          <Badge variant="gray" className="font-mono ml-1">
            <LuWrench className="mr-1" />
            {camelCaseToWords(toolCall.toolName)}
          </Badge>
          {result && (
            <LuCheck className="text-emerald-500" />
          )}
        </div>
        <LuChevronRight className={cn(
          "transition-transform duration-200",
          isExpanded ? "rotate-90" : "rotate-0"
        )} />
      </div>
      {isExpanded && (
        
          <div className="mt-4 p-2 md:p-1.5">
            <div className="mb-2 text-sm text-muted-foreground">Parameters:</div>
            <CodeBlock className="language-json" parentClassName="max-h-[300px] md:max-h-[200px] overflow-y-auto">
              {JSON.stringify(toolCall.args, null, 2)}
            </CodeBlock>
            
            {result && (
              <>
                <div className="mt-3 mb-2 text-sm text-muted-foreground">Result:</div>
                <CodeBlock className="language-json" parentClassName="max-h-[300px] md:max-h-[200px] overflow-y-auto">
                  {JSON.stringify(result?.result?.[0]?.text ? JSON.parse(result.result[0].text) : result, null, 2)}
                </CodeBlock>
              </>
            )}
          </div>
        
      )}
    </div>
  );
}
