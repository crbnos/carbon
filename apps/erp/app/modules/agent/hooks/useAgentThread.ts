// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import posthog from "posthog-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentStore } from "~/stores/agent";
import { path } from "~/utils/path";
import { useBrowsingContext } from "./useBrowsingContext";

/** The text of the newest user message — the only thing a send puts on the wire. */
function lastUserText(messages: UIMessage[]): string | undefined {
  const last = messages.findLast((m) => m.role === "user");
  return last?.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
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
        // Only the newest question travels: the server loads the thread's history
        // itself, so nothing held in the browser reaches the model. A retry sends it
        // too, for when the first attempt was refused before the server saved it.
        prepareSendMessagesRequest: ({ messages, trigger }) => ({
          body: {
            threadId: threadIdRef.current,
            trigger,
            text: lastUserText(messages),
            context: contextRef.current
          }
        })
      }),
    []
  );

  const {
    messages,
    sendMessage,
    setMessages,
    status,
    stop,
    error: chatError,
    regenerate,
    clearError
  } = useChat({ transport });
  // Set when a send could not even start (no thread); the chat's own error covers the rest.
  const [sendError, setSendError] = useState<Error | null>(null);
  const error = chatError ?? sendError ?? undefined;

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
        .then((res) => {
          if (!res.ok) throw new Error(`Thread create failed: ${res.status}`);
          return res.json() as Promise<{ threadId?: string }>;
        })
        .then((data) => {
          const id = data.threadId ?? null;
          // Don't clobber a thread that loadThread/newThread selected while this
          // create was in flight — only adopt the new id if nothing was set meanwhile.
          if (id && !threadIdRef.current) {
            threadIdRef.current = id;
            setThread(id);
          }
          return threadIdRef.current ?? id;
        })
        .catch(() => null)
        .finally(() => {
          createInFlight.current = null;
        });
    }
    return createInFlight.current;
  }

  // Guards the async gap between the isStreaming check and sendMessage, so rapid
  // clicks can't fire duplicate turns before the stream status flips.
  const isPreparingRef = useRef(false);
  // A question whose thread could not be created never reached useChat, so Retry resends it.
  const unsentRef = useRef<string | null>(null);
  async function send(text: string) {
    // One turn at a time: ignore sends (from the input or a block action) mid-stream.
    if (isStreamingRef.current || isPreparingRef.current) return;
    isPreparingRef.current = true;
    try {
      posthog.capture("agent_message_sent", {
        hasContext: !!contextRef.current
      });
      setSendError(null);
      const id = await ensureThread();
      if (!id) {
        unsentRef.current = text;
        setSendError(new Error("Could not start a conversation"));
        return;
      }
      unsentRef.current = null;
      sendMessage({ text });
    } finally {
      isPreparingRef.current = false;
    }
  }

  // Re-answer the last question after a failed turn, from the stored thread — or resend
  // a question that never left the browser.
  const retry = () => {
    if (isStreamingRef.current) return;
    const unsent = unsentRef.current;
    if (unsent) {
      void send(unsent);
      return;
    }
    setSendError(null);
    clearError();
    void regenerate();
  };

  // Switching threads stops the current answer, and a slow response for a thread the
  // user has already left is ignored, so one thread's messages never show under another.
  const loadSeq = useRef(0);

  // Reset in place (no navigation) so the panel never flickers closed.
  const newThread = useCallback(() => {
    ++loadSeq.current;
    unsentRef.current = null;
    void stop();
    // stop() and setMessages() leave useChat's error in place.
    clearError();
    setMessages([]);
    setSendError(null);
    setThread(null);
    threadIdRef.current = null;
  }, [clearError, setMessages, setThread, stop]);

  const loadThread = useCallback(
    async (id: string) => {
      const seq = ++loadSeq.current;
      void stop();
      clearError();
      setSendError(null);
      setThread(id);
      threadIdRef.current = id;
      const res = await fetch(path.to.api.agentThread(id));
      if (seq !== loadSeq.current) return;
      if (!res.ok) {
        // Stale/archived thread (e.g. a persisted id resumed from a previous
        // session) — fall back to a fresh chat so sends don't post to a dead thread.
        newThread();
        return;
      }
      // The server returns the thread ready to show (`toDisplayMessages`).
      const data = (await res.json()) as { messages: UIMessage[] };
      if (seq !== loadSeq.current) return;
      setMessages(data.messages);
    },
    [clearError, newThread, setMessages, setThread, stop]
  );

  // Resume the last chat when the panel opens: if it mounted with a persisted thread
  // id (restored from sessionStorage), load that thread's history. A new chat
  // (threadId null) stays blank — so the agent resumes until the user starts a new one.
  const didResume = useRef(false);
  useEffect(() => {
    if (didResume.current) return;
    didResume.current = true;
    if (threadIdRef.current) void loadThread(threadIdRef.current);
  }, [loadThread]);

  return {
    messages,
    error,
    isStreaming,
    send,
    retry,
    stop,
    loadThread,
    newThread,
    // Escape hatch for the dev-only block viewer; not for feature code.
    setMessages
  };
}
