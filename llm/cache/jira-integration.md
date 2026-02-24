# Jira Integration

## Key Implementation Details

### Jira Search API

- The Jira search endpoint was migrated from `/search` to `/search/jql` (the old endpoint was deprecated with a 410 response). See `packages/ee/src/jira/lib/client.ts` `searchIssues` method.

### Unlinking Jira Issues

- `unlinkActionFromJiraIssue` in `packages/ee/src/jira/lib/service.ts` uses `getCarbonServiceRole()` (service role client) to delete from `externalIntegrationMapping` because the table has no DELETE RLS policy for authenticated users.
- The DELETE handler in `apps/erp/app/routes/api+/integrations.jira.issue.link.ts` unlinks from Carbon's DB first, then does best-effort Jira remote link cleanup.
- Remote link cleanup fetches actual links via `getRemoteLinks()` and finds the Carbon link by `application.name === "Carbon"` or `globalId.startsWith("carbon-")` rather than reconstructing the globalId from a URL.

### RLS on externalIntegrationMapping

- The table only has SELECT and INSERT RLS policies (defined in migration `20260204001831`). No UPDATE or DELETE policies exist.
- Any delete operations must use the service role client (`getCarbonServiceRole()`).

### Modal Scroll

- `ModalContent` has `max-h-[85vh]` to prevent modals from exceeding the viewport.
- `ModalBody` has `overflow-y-auto` so body content scrolls internally.

### Jira Dialog UI

- `IssueDialog.tsx` resets tab to "link" on close, and closes the dialog after unlink.
- `ModalHeader` uses `pr-10` to prevent close button overlap with tabs.
- `ModalFooter` inside `ModalBody` uses `className="px-0 pb-0"` to avoid double padding.
