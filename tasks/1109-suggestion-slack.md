# Task: Suggestion Box → Slack Channel Notification (Issue #1109)

## Objective

When a user submits a suggestion via the in-app suggestion box, post a Slack message to the company's configured Slack channel.

## The Pattern to Follow (Exactly)

Look at `apps/erp/app/routes/x+/feedback.tsx`. The suggestion route needs the same treatment.

In `apps/erp/app/routes/x+/resources+/suggestions.new.tsx`:

1. After the `insertSuggestion` succeeds, fetch `company.slackChannel` from Supabase (serviceRole, filter by `companyId`)
2. Look up the submitter's name: use `formUserId` to query `user.select("fullName")` — fall back to "Anonymous" if null/missing
3. Build a Slack Block Kit message and call `getSlackClient().sendMessage()`:
   - Channel: `company.slackChannel` (prefixed with `#` if needed) OR default to `#suggestions`
   - Blocks:
     - Section: `${emoji} New suggestion submitted`
     - Fields: Suggestion text, Submitted by (name), Link (`/x/resources/suggestions/:id`)
4. Wrap the Slack call in try/catch — a Slack failure must NEVER prevent the insert response from returning `{ success: true }`

## Key imports to use (already used in the codebase)

```ts
import { getSlackClient } from "@carbon/lib/slack.server";
```

## Acceptance Criteria

1. Submitting a suggestion posts a Slack Block Kit message to `#suggestions` (or the configured `slackChannel`) with: emoji, suggestion text, submitter name (or "Anonymous"), and a link to the suggestion in the ERP
2. If Slack send fails (network, invalid channel, etc.), the suggestion insert still returns `{ success: true }` to the user
3. Works for both authenticated (`formUserId` set) and anonymous (`formUserId` null) submissions

## Proof

Write a unit test (or integration test) that mocks `getSlackClient().sendMessage` and verifies:
- It is called with the correct channel and that the blocks contain the suggestion text and submitter name
- When `sendMessage` throws, the action still returns `{ success: true }`

If unit testing the action is not feasible, document it as unverified and note what a human should check manually.

## Files to touch

- `apps/erp/app/routes/x+/resources+/suggestions.new.tsx` — primary change
- Test file for the above (new file or existing test suite)

## Do NOT touch

- DB schema (no migrations needed — `slackChannel` already exists on `company`)
- Settings UI (out of scope for this issue)
- The in-app notification trigger (keep it as-is)

## Reference

- Pattern: `apps/erp/app/routes/x+/feedback.tsx`
- Slack client: `packages/lib/src/slack.server.ts` (check for `getSlackClient`)
- Issue: https://github.com/crbnos/carbon/issues/1109
