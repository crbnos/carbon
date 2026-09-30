# Agent: server-owned history (pass 1 — correctness and security)

Branch `fix/agent-server-history`. Source: the read-only review of the agent layer
(2026-09-30). Decision: the existing `agentThread` / `agentMessage` / `agentMessagePart`
tables are the source of truth for what the model sees; the browser sends only its new
message.

## Tasks

- [ ] **Chat request carries one message.** `chatRequest` = `{ threadId, trigger, text?, context? }`
  with length caps. `useAgentThread`'s transport sends the last user message's text, or
  `trigger: "regenerate-message"` and no text for a retry.
- [ ] **Thread ownership up front.** The chat route reads the thread under `companyId` +
  `userId` and 404s a missing or foreign one. `thread.$threadId` 404s too. The browser
  aborts a send when the thread cannot be created instead of spawning orphan threads.
- [ ] **History from the database.** `buildModelHistory` (`agent.history.ts`, pure): user and
  assistant TEXT only, an unanswered user message dropped unless it is the last one, then
  the char-budget window. Replaces `compactEarlierToolOutputs` and client history.
- [ ] **One transaction per write.** `saveUserMessage` and `persistAssistantTurn` run in a
  Kysely transaction (`db` passed from the route). Nothing is persisted for a turn that
  errored or produced no parts; an aborted turn keeps its complete parts with
  `finishReason: "aborted"`.
- [ ] **Assistant ids match rows.** `generateMessageId` mints the `agm…` id the row is
  inserted with; feedback posts that `messageId`, not "latest assistant message".
- [ ] **Stream hygiene.** `abortSignal: request.signal`, `consumeSseStream: consumeStream`,
  a masked `onError` message, titling started in parallel with the answer.
- [ ] **Retry.** The error banner offers Retry (`regenerate()`); the server answers the
  stored unanswered question without saving a new one.
- [ ] **Stop after choices.** `stopWhen` includes `hasToolCall("present_choice")`.
- [ ] **Thread switching.** `loadThread` stops an active stream and ignores stale responses.
- [ ] Tests for every pure piece; typecheck ERP; rules updated.

## Verification

`apps/erp`: `pnpm exec vitest run app/modules/agent`, `pnpm exec tsgo --noEmit`.
