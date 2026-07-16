# Task Brief: feat: post new suggestions to a configurable Slack channel (#1109)

## Objective

Implement GitHub issue #1109: when a suggestion is submitted via the in-app suggestion box, post a message to a configured Slack channel.

## Context

- Issue: https://github.com/crbnos/carbon/issues/1109
- Branch to create: `agent/1109-slack-suggestion-notifications`
- Base: `origin/main`
- Repo: `/home/openclaw/carbon`

## Existing Infrastructure (confirmed present)

- `packages/jobs/src/inngest/functions/notifications/notify.ts` — handles `NotificationEvent.SuggestionResponse`, extend this
- `packages/jobs/src/inngest/functions/integrations/slack-document-sync.ts` — existing `WebClient.chat.postMessage` pattern to reuse
- `companyIntegration` table — Slack integration already wired for document sync
- `settings.models.ts` — contains `suggestionNotificationValidator` — check if extendable for channel config

## Binding

```yaml
id: "1109-slack-suggestions"
kind: feature
risk: low
issue: 1109
title: "Post new suggestions to a configurable Slack channel"
acceptance:
  - A settings field (Settings → Resources or Integrations → Slack) lets admins configure a target Slack channel ID for suggestion notifications
  - When a suggestion is submitted, a Slack message is posted containing: suggestion text, emoji, submitter name (or "Anonymous"), and a direct link to /x/resources/suggestions/:id
  - If no channel is configured, no error is thrown — silent skip
  - Works for both authenticated and anonymous submissions
  - All existing tests pass (typecheck, biome lint, conformance)
```

## Implementation Notes from Issue

- Extend the `notify` Inngest job's `SuggestionResponse` handler to also call `WebClient.chat.postMessage` when a channel is configured
- Store the target channel ID on the company record or company integration metadata (similar to `suggestionNotificationGroup`)
- Reuse/extend `suggestionNotificationValidator` in `settings.models.ts` for the new channel field
- Pattern for Slack posting: copy from `slack-document-sync.ts`

## What I Need Back

1. A working PR on branch `agent/1109-slack-suggestion-notifications` with `Closes #1109` in the body
2. All gate checks passing (typecheck, lint, conformance)
3. outcome.json written to the binding path

## Safety

- pnpm, NEVER npm
- Use ABSOLUTE paths for everything
- Do not merge — open a PR only
- Do not commit credentials
