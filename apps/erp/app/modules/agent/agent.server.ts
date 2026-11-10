// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CarbonError, defineServiceFn } from "@carbon/api/service-fn.server";
import { companyHasFeature } from "@carbon/ee/plan.server";
import { Ratelimit, redis } from "@carbon/kv";
import { z } from "zod";
import { chatRequest } from "./agent.models";
import * as service from "./agent.service";

const agentRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "5 m")
});
/**
 * Start a chat with the in-app assistant: a new, empty thread of the caller's.
 */
export const createAgentThread = defineServiceFn({
  input: z.object({}),
  permission: {},

  async run(ctx) {
    const created = await service.createThread(ctx.asCaller.supabase, {
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    });
    if (created.error) {
      return ctx.error("internal", "Failed to create the chat", created.error);
    }
    return { threadId: created.data.id };
  }
});

/**
 * Delete one of the caller's chats with the in-app assistant, with its
 * messages.
 */
export const deleteAgentThread = defineServiceFn({
  input: z.object({ threadId: z.string().min(1) }),
  permission: {},

  async run(ctx, { threadId }) {
    const deleted = await service.deleteThread(ctx.asCaller.supabase, {
      threadId,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    });
    if (deleted.error) {
      return ctx.error("internal", "Failed to delete the chat", deleted.error);
    }
    return { threadId };
  }
});

/**
 * Start a turn of the in-app assistant: save the question, and return the
 * conversation its answer is drawn from.
 *
 * @remarks
 * Needs a plan that includes the AI agent, and is rate-limited per user and
 * company (30 messages in 5 minutes). The thread must be the caller's own. A
 * new question is saved to it. A retry (`regenerate-message`) answers the
 * stored, unanswered question when it is the one retried; otherwise that
 * question was refused before it was saved, so the retry's own text is saved
 * and answered. `history` is the thread, ending with the question;
 * `isNewQuestion` is whether one was saved (the thread may need a title).
 */
export const startAgentTurn = defineServiceFn({
  input: chatRequest,
  permission: {},

  async run(ctx, { threadId, trigger, text, context }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const allowed = await companyHasFeature(client, companyId, {
      feature: "AI_AGENT"
    });
    if (!allowed) return ctx.error("entitlement", "Upgrade required");

    const { success } = await agentRatelimit.limit(
      `agent:${companyId}:${userId}`
    );
    if (!success) {
      return ctx.error(
        "rateLimited",
        "Rate limit exceeded. Please wait a moment."
      );
    }

    // The browser sends only its new message and a thread id: the thread must
    // be the caller's own before anything is written to it or read back.
    const thread = await service.getThread(client, {
      threadId,
      companyId,
      userId
    });
    if (thread.error) {
      return ctx.error(
        "internal",
        "Failed to load the conversation",
        thread.error
      );
    }
    if (!thread.data) return ctx.error("notFound", "Conversation not found");

    const saveQuestion = async (question: string) => {
      try {
        await service.saveUserMessage(ctx.asSystem.pg, {
          threadId,
          companyId,
          userId,
          text: question,
          context
        });
        return null;
      } catch (error) {
        return ctx.error("internal", "Failed to save your message", error);
      }
    };
    const loadHistory = async () => {
      const history = await service.getModelHistory(client, {
        threadId,
        companyId
      });
      if (history.error) {
        return ctx.error(
          "internal",
          "Failed to load the conversation",
          history.error
        );
      }
      return history.data;
    };

    let isNewQuestion = false;
    if (trigger === "submit-message" && text) {
      const failed = await saveQuestion(text);
      if (failed) return failed;
      isNewQuestion = true;
    }
    let history = await loadHistory();
    if (history instanceof CarbonError) return history;

    if (trigger === "regenerate-message") {
      const last = history.at(-1);
      const pending =
        last?.role === "user"
          ? last.parts
              .map((part) => (part.type === "text" ? part.text : ""))
              .join("")
          : null;
      if (text && text !== pending) {
        const failed = await saveQuestion(text);
        if (failed) return failed;
        isNewQuestion = true;
        history = await loadHistory();
        if (history instanceof CarbonError) return history;
      } else if (pending === null) {
        return ctx.error("conflict", "There is no question to answer");
      }
    }

    return { history, isNewQuestion };
  }
});
