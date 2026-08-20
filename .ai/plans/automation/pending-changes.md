# Workflow Feature — Pending Changes

Rough list of changes to plan and execute. Add new items as they come up.

---

## 1. Remove webhook signing secret

The workflow creation flow shows a one-time "webhook secret" to the user for verifying outbound webhook calls via HMAC signatures. This is overkill — users can just add auth headers to the webhook action themselves.

Remove entirely:
- `webhookSecret` column from `workflow` table (migration to drop it)
- `insertWorkflow` no longer selects `webhookSecret` back
- `WorkflowForm.tsx` — remove the "Workflow created" secret reveal screen, just navigate to the new workflow directly
- `packages/jobs/src/workflows/actions/webhook.ts` — remove signing logic (HMAC, `Carbon-Timestamp`, `Carbon-Signature` headers)
- `packages/database/supabase/migrations/20260731025358_workflows-webhook-secret.sql` — if not yet applied to prod, can just drop; otherwise need a new migration to drop the column
- Any types referencing `webhookSecret`

---

## 2. Fix breadcrumb on workflow detail page

Currently shows just `/workflows`. Should show `Workflows / {workflow name}` since you're on the detail page of a specific workflow.

---

## 3. Remove right drawer — node config goes inline inside the node

Right now clicking a node opens a config panel in a right-side drawer. Remove the drawer entirely. All configuration for a node should live inside the node card itself (expanded inline when selected or always visible).

---

## 4. Change handle direction: top/bottom → left/right

Currently nodes connect top-to-bottom (output at bottom, input at top). Flip to left-to-right: input handles on the left side of the node, output handles on the right side. Edges flow horizontally.

---

## 5. Better handle design

Handles are too small and hard to grab. Make them:
- Bigger circles
- Box shadow on hover for visual feedback
- Generally cleaner, easier to grab

---

## 6. Redesign left sidebar (node palette)

Currently just plain text labels slapped in a list — looks broken. Also the items have a weird border on the right and don't resize properly with the sidebar. Fix:
- Properly styled list with icon + node name + short description per item
- No weird borders, items should resize correctly with the sidebar
- Remove per-node colors — use only the company's theme color
- Each node type gets an icon

---

## 7. Node card redesign — icons, theme color, no per-node colors

Currently nodes are colored differently per type. Change to:
- Single theme color (from user's company theme) for all nodes
- Icon for each node type
- Show: icon + node name (+ description if space) on the card
- Consistent with how nodes appear in the left sidebar

---

<!-- Add more changes below as the user describes them -->
