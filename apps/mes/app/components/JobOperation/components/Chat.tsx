// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { getLogger } from "@carbon/logger";
import { useChangedRows } from "@carbon/query";
import {
  Avatar,
  Button,
  cn,
  Input,
  Loading,
  ScrollArea,
  useDebounce
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { LuArrowUp } from "react-icons/lu";
import { DateTime } from "~/components";
import { useUser } from "~/hooks";
import type { OperationWithDetails } from "~/services/types";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

const log = getLogger("mes", "job-operation");

type Message = {
  id: string;
  createdBy: string;
  createdAt: string;
  note: string;
};

export type OperationNotes = ReturnType<typeof useOperationNotes>;

/** The operation's notes, kept live; the tab reads its count before Notes opens. */
export function useOperationNotes(operationId: string | undefined) {
  const user = useUser();
  const { carbon } = useCarbon();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Only the newest read may land: switching operations mid-read would
  // otherwise show the previous operation's notes.
  const latestRead = useRef(0);

  const fetchChats = async () => {
    if (!carbon || !operationId) return;
    const read = ++latestRead.current;
    setIsLoading(true);

    const { data, error } = await carbon
      .from("jobOperationNote")
      .select("*")
      .eq("companyId", user.company.id)
      .eq("jobOperationId", operationId)
      .order("createdAt", { ascending: true });

    if (read !== latestRead.current) return;
    setIsLoading(false);
    if (error) {
      log.error("Failed to fetch job operation notes", { error });
      return;
    }
    setMessages(data);
  };

  useEffect(() => {
    setMessages([]);
    fetchChats();
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- fetchChats is recreated every render
  }, [operationId, carbon]);

  useChangedRows<Message & { jobOperationId: string }>({
    companyId: user.company.id,
    table: "jobOperationNote",
    // jobOperationId has no foreign key, so broadcasts carry no parent ids and
    // this filter lets every note through; the row check below decides.
    filter: `jobOperationId=eq.${operationId}`,
    enabled: !!operationId,
    onResync: fetchChats,
    onChange: ({ op, rows }) => {
      if (op !== "INSERT") return;
      const notes = rows.filter((row) => row.jobOperationId === operationId);
      setMessages((prev) => [
        ...prev,
        ...notes.filter((note) => !prev.some((p) => p.id === note.id))
      ]);
    }
  });

  return { messages, setMessages, isLoading };
}

export function OperationChat({
  operation,
  notes
}: {
  operation: OperationWithDetails;
  notes: OperationNotes;
}) {
  const { t } = useLingui();
  const user = useUser();
  const { carbon } = useCarbon();

  const [employees] = usePeople();
  const { messages, setMessages, isLoading } = notes;

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      block: "start",
      behavior: messages.length > 0 ? "smooth" : "auto"
    });
  }, [messages]);

  const [message, setMessage] = useState("");

  const notify = useDebounce(
    async (noteId: string) => {
      if (!carbon) return;

      const response = await fetch(path.to.messagingNotify, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          type: "jobOperationNote",
          operationId: operation.id,
          noteId
        }),
        credentials: "include" // This is sufficient for CORS with cookies
      });

      if (!response.ok) {
        log.error("Failed to notify user");
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
      companyId: user.company.id
    };

    flushSync(() => {
      setMessages((prev) => [...prev, newMessage]);
      setMessage("");
    });

    await Promise.all([
      carbon?.from("jobOperationNote").insert(newMessage),
      notify(newMessage.id)
    ]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
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
                          "rounded-xl p-3 w-full flex flex-col gap-1",
                          isUser ? "bg-blue-500 text-white" : "bg-muted"
                        )}
                      >
                        <p className="text-sm">{m.note}</p>

                        <span className="text-xs opacity-70">
                          <DateTime value={m.createdAt} variant="time" />
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
            placeholder={t`Type a message...`}
            aria-label={t`Message`}
            name="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <Button
            className="h-10"
            aria-label="Send"
            type="submit"
            leftIcon={<LuArrowUp />}
          >
            <Trans>Send</Trans>
          </Button>
        </form>
      </div>
    </div>
  );
}
