import {
  Avatar,
  Button,
  cn,
  Input,
  Loading,
  ScrollArea,
  useDebounce,
  useMount,
} from "@carbon/react";
import { useEffect, useRef, useState } from "react";
import { useUser } from "~/hooks";
import type { OperationWithDetails } from "~/services/types";
import { path } from "~/utils/path";

import { useCarbon } from "@carbon/auth";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { flushSync } from "react-dom";
import { LuSend } from "react-icons/lu";
import { usePeople } from "~/stores";

type Message = {
  id: string;
  createdBy: string;
  createdAt: string;
  note: string;
};

export function OperationChat({
  operation,
}: {
  operation: OperationWithDetails;
}) {
  const user = useUser();
  const [employees] = usePeople();
  const [messages, setMessages] = useState<Message[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const { carbon, accessToken } = useCarbon();

  const fetchChats = async () => {
    if (!carbon) return;
    flushSync(() => {
      setIsLoading(true);
    });

    const { data, error } = await carbon
      ?.from("jobOperationNote")
      .select("*")
      .eq("jobOperationId", operation.id)
      .order("createdAt", { ascending: true });

    if (error) {
      console.error(error);
      return;
    }
    setMessages(data);
    setIsLoading(false);
  };

  useMount(() => {
    fetchChats();
  });

  const channelRef = useRef<RealtimeChannel | null>(null);

  useMount(() => {
    if (!channelRef.current && carbon && accessToken) {
      carbon.realtime.setAuth(accessToken);
      channelRef.current = carbon
        .channel(`job-operation-notes-${operation.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "jobOperationNote",
            filter: `jobOperationId=eq.${operation.id}`,
          },
          (payload) => {
            setMessages((prev) => {
              if (prev.some((note) => note.id === payload.new.id)) {
                return prev;
              }
              return [...prev, payload.new as Message];
            });
          }
        )
        .subscribe();
    }

    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        carbon?.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  });

  useEffect(() => {
    if (carbon && accessToken && channelRef.current)
      carbon.realtime.setAuth(accessToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      block: "start",
      behavior: messages.length > 0 ? "smooth" : "auto",
    });
  }, [messages]);

  const [message, setMessage] = useState("");

  const notify = useDebounce(
    async () => {
      if (!carbon) return;

      const response = await fetch(path.to.messagingNotify, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "jobOperationNote",
          operationId: operation.id,
        }),
        credentials: "include", // This is sufficient for CORS with cookies
      });

      if (!response.ok) {
        console.error("Failed to notify user");
      }
    },
    5000,
    true
  );

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!message.trim()) return;

    const newMessage = {
      id: nanoid(),
      jobOperationId: operation.id,
      createdBy: user.id,
      note: message,
      createdAt: new Date().toISOString(),
      companyId: user.company.id,
    };

    flushSync(() => {
      setMessages((prev) => [...prev, newMessage]);
      setMessage("");
    });

    await Promise.all([
      carbon?.from("jobOperationNote").insert(newMessage),
      notify(),
    ]);
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-var(--header-height)*2)]">
      <ScrollArea className="flex-1 p-4">
        <Loading isLoading={isLoading}>
          <div className="flex flex-col gap-3">
            {messages.map((m) => {
              const createdBy = employees.find(
                (employee) => employee.id === m.createdBy
              );
              const isUser = m.createdBy === user.id;
              return (
                <div
                  key={`message-${m.id}`}
                  className={cn(
                    "flex gap-2 items-end",
                    isUser && "flex-row-reverse"
                  )}
                >
                  <Avatar
                    src={createdBy?.avatarUrl ?? undefined}
                    name={createdBy?.name}
                  />

                  <div className="flex flex-col gap-1 max-w-[80%] ">
                    <div className="flex flex-col gap-1">
                      {!isUser && (
                        <span className="text-xs opacity-70">
                          {createdBy?.name}
                        </span>
                      )}
                      <div
                        className={cn(
                          "rounded-2xl p-3 w-full flex flex-col gap-1",
                          isUser ? "bg-blue-500 text-white" : "bg-muted"
                        )}
                      >
                        <p className="text-sm">{m.note}</p>

                        <span className="text-xs opacity-70">
                          {new Date(m.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} style={{ height: 0 }} />
          </div>
        </Loading>
      </ScrollArea>

      <div className="border-t p-4">
        <form className="flex gap-2" onSubmit={handleSubmit}>
          <Input
            className="flex-1"
            placeholder="Type a message..."
            name="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <Button
            className="h-10"
            aria-label="Send"
            type="submit"
            leftIcon={<LuSend />}
          >
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}
