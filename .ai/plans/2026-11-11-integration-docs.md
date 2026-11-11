# Integration documentation — implementation plan

**Spec:** none. The source is the user request "write documentation for missing integrations and update the existing ones".
**Research:** the inventory below (2026-11-11, from `packages/ee/src/index.ts`, `packages/ee/src/*/config.tsx`, `docs/content/docs/integrations/`, `.claude/rules/`).
**Closest sibling:** for each new page, the task names the closest existing page about an integration.
**Branch:** `naveencarbon/integration-docs`, created from `origin/main`. Do not use `naveencarbon/stripe-connect-express-full`.

## Decisions to confirm before `/execute`

| # | Decision | Recommendation |
|---|----------|----------------|
| D1 | `accounting.mdx` documents QuickBooks Online, but `packages/ee/src/quickbooks/config.tsx:13` has `active: false`. The carbon-docs skill says to document only active integrations. | Remove QuickBooks from the docs site (Task 10). Keep the code as it is. |
| D2 | Stripe Connect is in progress on another branch. `config.tsx` gates it with `STRIPE_CONNECT_ENABLED`. | Write the developer docs when that branch merges (Task 7). Write `payments.mdx` only after Stripe Connect is enabled on Carbon Cloud (Task 15). |
| D3 | Linear, Rillet, Paperless Parts, Sense and Gmail have connect steps on their category pages but no setup guide. | Add setup guides for Linear and Rillet only. These two have siblings with a setup guide: Jira and Xero. For the others, the setup index links to their category page, the same way it links to Onshape. |
| D4 | Radan (commented out in `index.ts`), QuickBooks and Sage (`active: false`) are not active. | Do not write user docs for them. Mention them in the framework rule as "registered, not active". |
| D5 | Gaps come back when a new integration ships without docs. A check can find a registered integration with no rule. | Add a `@carbon/checks` check (Task 18). It changes the commit gate, so confirm it first. |

## Gap types and the fix for each

| Gap type | Example | Fix | Task |
|---|---|---|---|
| An active integration has no developer rule | Mount, Paperless Parts, Slack, Email, Gmail | Write a rule from the source. Copy the shape of `jira-integration.md`. | 2–5 |
| The shared code has no guide | `packages/ee/src/integrations/`, `sync/`, `types.ts` | Write one framework rule with an "Add a new integration" checklist. | 1 |
| A rule exists, but it does not auto-load | No `paths:` glob matches `packages/ee/src/sync`, `xero/config.tsx` or `rillet/config.tsx` | Add the code globs to the `paths:` frontmatter. | 17 |
| A rule or page describes old behavior | `xero-webhooks.md` (5 commits since), `estimating.mdx` (6) | Read the diff since the last doc commit. Correct only what changed. | 6, 14 |
| An active integration has no user page | Mount, Ramp (setup guide only), Stripe Connect | Write a page of the type the task names. Add it to `meta.json` and the index. | 8, 9, 13, 15 |
| A user page documents an inactive integration | QuickBooks in `accounting.mdx` | Remove the text. | 10 |
| The design history is hard to find | Specs and plans spread over `.ai/specs/` and `.ai/plans/` | List them per integration in the framework rule. | 1 |
| Nothing stops the next gap | A new integration merges with no rule | Add a coverage check. | 18 |

## Inventory

### Registry (`packages/ee/src/index.ts:75`)

| Integration | Category | `active` | User docs | Developer docs |
|---|---|---|---|---|
| Email | Email | true | `email.mdx` | none |
| Gmail | Email | `!!GOOGLE_CLIENT_ID` | `email.mdx`, `workflow-apps.mdx` | none |
| Google Calendar | Productivity | `!!GOOGLE_CLIENT_ID` | `workflow-apps.mdx` | none |
| Jira | Project Management | `!!JIRA_CLIENT_ID` | `project-management.mdx`, `setup/jira.mdx` | `jira-integration.md`, `issue-sync.md` |
| Linear | Project Management | true | `project-management.mdx` | `linear-integration.md`, `issue-sync.md` |
| Mount | Quality | true | **none** | **none** |
| Onshape, Onshape Government, Onshape v2 | CAD | `!!ONSHAPE_CLIENT_ID` / true | `cad.mdx` | `onshape-panel.md` |
| Paperless Parts | Estimating & Quoting | true | `estimating.mdx` | **none** |
| QuickBooks Online | Accounting | **false** | `accounting.mdx` (see D1) | `accounting-sync-handlers.md` |
| Ramp | Spend Management | `!!RAMP_CLIENT_ID` | `setup/ramp.mdx` only, no category page | `ramp-integration.md` |
| Rillet | Accounting | true | `accounting.mdx` | `accounting-sync-handlers.md` |
| Sage Intacct | Accounting | **false** | none (correct) | none |
| Sense | Machine Monitoring | true | `oee.mdx` | `oee-provider.md` |
| Slack | Assistant | `CONTROLLED_ENVIRONMENT === false` | `assistant.mdx`, `setup/slack.mdx`, `workflow-apps.mdx` | **none** |
| Stripe Connect | Payments | `STRIPE_CONNECT_ENABLED` | **none** | `packages/ee/src/stripe-connect/AGENTS.md`, `packages/stripe/AGENTS.md` |
| Xero | Accounting | true | `accounting.mdx`, `setup/xero.mdx` | `xero-api-contact-structure.md`, `xero-webhooks.md`, `accounting-sync-handlers.md` |
| Shared framework | — | — | `index.mdx` | **none** (`packages/ee/src/integrations/`, `sync/`, `types.ts`, `oauth-popup.ts`) |

### Changes since the last doc update

The count is the number of commits to the integration code after the doc file's last commit.

| Doc file | Last update | Code commits since |
|---|---|---|
| `docs/content/docs/integrations/estimating.mdx` | 2026-10-02 | 6 |
| `.claude/rules/xero-webhooks.md` | 2026-09-26 | 5 |
| `docs/content/docs/integrations/accounting.mdx` | 2026-10-28 | 4 |
| `docs/content/docs/integrations/cad.mdx` | 2026-11-10 | 4 |
| `docs/content/docs/integrations/workflow-apps.mdx` | 2026-10-28 | 4 |
| `.claude/rules/workflow-integrations.md` | 2026-10-28 | 4 |
| `.claude/rules/ramp-integration.md` | 2026-10-17 | 3 |
| `packages/ee/src/stripe-connect/AGENTS.md` | 2026-10-17 | 3 |
| `.claude/rules/xero-api-contact-structure.md` | 2026-10-13 | 2 |
| `.claude/rules/accounting-sync-handlers.md` | 2026-11-04 | 2 |
| `.claude/rules/oee-provider.md` | 2026-11-04 | 2 |
| `.claude/rules/onshape-panel.md` | 2026-11-11 | 2 |
| `docs/content/docs/integrations/oee.mdx` | 2026-11-04 | 2 |
| `docs/content/docs/integrations/setup/ramp.mdx` | 2026-10-28 | 2 |
| `docs/content/docs/integrations/setup/jira.mdx` | 2026-10-28 | 2 |
| `jira-integration.md`, `linear-integration.md`, `project-management.mdx`, `email.mdx`, `setup/xero.mdx`, `setup/slack.mdx` | 2026-10-28 to 2026-11-04 | 1 each |

Every path in code font in the 10 integration rule files resolves to a real file. A count of commits does not prove drift. Tasks 6 and 14 read each diff.

### Rules that auto-load for each code directory

A rule auto-loads only when a glob in its `paths:` frontmatter matches the edited file.

| `packages/ee/src/` directory | Rule that auto-loads |
|---|---|
| `jira`, `linear`, `issue-sync`, `ramp`, `onshape`, `sense`, `oee`, `integrations` | a rule exists |
| `google-calendar` | `workflow-integrations.md` only (the workflow piece, not the integration) |
| `accounting` (includes `accounting/providers/xero` and `accounting/providers/rillet`) | `accounting-sync-handlers.md`, `xero-webhooks.md`, `xero-api-contact-structure.md` |
| `xero`, `rillet` (`config.tsx` and `hooks.server.ts` only) | **none** |
| `sync` (10 files: capabilities, topology, delegation) | **none**, but `accounting-sync-handlers.md` describes this code |
| `email`, `gmail`, `mount`, `paperless-parts`, `slack`, `stripe-connect` | **none** (Tasks 2–5 and 7 add them) |
| `quickbooks`, `sage`, `radan` | none (inactive, see D4) |

## Progress

- [x] Task 1: Create the integration framework rule
- [x] Task 2: Create the Mount rule
- [x] Task 3: Create the Paperless Parts rule
- [x] Task 4: Create the Slack rule
- [x] Task 5: Create the email and Google rule
- [x] Task 6: Refresh the existing integration rules
- [ ] Task 7: Refresh the Stripe Connect AGENTS.md (after D2) — skipped: Stripe Connect is in progress
- [x] Task 8: Create the Quality page for Mount
- [x] Task 9: Create the Spend management page for Ramp
- [x] Task 10: Remove QuickBooks from the accounting page (D1)
- [x] Task 11: Create the Linear setup guide
- [x] Task 12: Create the Rillet setup guide
- [x] Task 13: Update the integration index pages and navigation
- [x] Task 14: Refresh the existing integration pages
- [ ] Task 15: Create the Payments page for Stripe Connect (after D2) — skipped: Stripe Connect is in progress
- [x] Task 16: Verify the docs site and the agent knowledge base
- [x] Task 17: Make the existing rules auto-load for their code
- [x] Task 18: Add a check for integrations with no rule (after D5)

## Dependencies

- Tasks 1–6 are independent. Run them as parallel subagents.
- Task 7 needs the Stripe Connect branch merged into `main`.
- Tasks 8–12 are independent. Each new page needs Task 13 before the build can link to it.
- Task 13 needs Tasks 8, 9, 11 and 12.
- Task 14 is independent of Tasks 8–13.
- Task 15 needs D2 resolved.
- Task 17 is independent. Run it before Task 6, so the refreshed rules also load.
- Task 18 needs Tasks 1–5, 7 and 17. Without them, the check fails on the current gaps.
- Task 16 needs every other task that you run.

## Common procedure — developer rule files (Tasks 1–6)

1. Read `.claude/skills/create-agents-md/SKILL.md`. Rule files follow its grounding rules and its "Done when" list.
2. Read the closest existing rule: `.claude/rules/jira-integration.md`.
3. Start each new rule with `paths:` frontmatter that lists the integration's code globs.
4. Use these sections: Overview, Key files, Data flow, Settings, Gotchas, Never.
5. Name only functions and tables that `grep` finds in the current source.
6. Keep the file between 80 and 200 lines.
7. Add one row to the **Integrations** section of the root `AGENTS.md` Task Router (line 141).
8. Do not add an SPDX header. Rule files carry none.

**Verify (for each rule file):**
```bash
f=.claude/rules/<file>.md
for x in $(grep -oE '`[A-Za-z0-9_./+$\[\]-]+\.(ts|tsx|md|sql)`' $f | tr -d '`' | sort -u); do
  ls "$x" >/dev/null 2>&1 || git ls-files "*${x#./}" | grep -q . || echo "MISSING $x"; done
grep -c "$(basename $f)" AGENTS.md
# Expected: no MISSING lines; the grep count is 1 or more
```

## Common procedure — user docs pages (Tasks 8–15)

1. Read `.claude/skills/carbon-docs/SKILL.md` and its `references/writing-guide.md`.
2. Use the page type that the task names. The plan approval answers the skill's page-type question.
3. Send one research subagent per integration. It returns a fact sheet with `file:line` references. The prompt says: "Write your report in STE-80 (`.claude/rules/writing-ste.md`)."
4. Write from the fact sheet only. If code and a rule file disagree, the code is correct.
5. Put error strings and troubleshooting in `<AgentContext>`, not in a visible section.
6. End each page with a `<Cards>` Related row.
7. Wrap literal braces in backticks. MDX fails the build on a bare `{item.id}`.

**Verify (for each page):**
```bash
p=docs/content/docs/integrations/<page>.mdx
awk '/<AgentContext>/{s=1} !s{print} /<\/AgentContext>/{s=0}' $p | wc -w
awk '/<AgentContext>/{s=1} !s{print} /<\/AgentContext>/{s=0}' $p | grep -o '—' | wc -l
# Expected: the word count is inside the page type's budget; at most 1 em-dash for each 150 words
```

---

## Task 1: Create the integration framework rule

**Depends on:** none
**Files:**
- Create: `.claude/rules/integrations-framework.md`
- Modify: `AGENTS.md` — add the row "Adding or changing an integration (registry, config, settings, OAuth, secrets)".
- Copy from (precedent): `.claude/rules/jira-integration.md`

**Steps:**
1. Read `packages/ee/src/types.ts`. Record `defineIntegration` and every field of the integration config, including `setupInstructions` (line 259).
2. Read `packages/ee/src/index.ts`. Record the `integrations` array, `IntegrationID`, the lookup helpers and the role filter (lines 372–405).
3. Read `packages/ee/src/integrations/connections.ts`, `connect.ts`, `secrets.ts`, `webhook-signature.ts` and `packages/ee/src/oauth-popup.ts`.
4. Read `packages/ee/src/sync/capabilities.ts` and `packages/ee/src/sync/topology.ts`.
5. Read `apps/erp/app/hooks/useIntegrations.tsx` and list the `apps/erp/app/routes/api+/integrations.*` routes.
6. Write how `active` works. Name the 3 gate types: a constant, an env var and a plan flag.
7. Write a section "Add a new integration". It is a numbered checklist that tells the reader to copy the closest sibling integration.
8. List Radan, QuickBooks and Sage as "registered, not active".
9. Read `.ai/specs/implemented/2026-08-15-integration-secret-encryption.md`. Link it from the secrets section.
10. Run `ls .ai/specs .ai/specs/implemented .ai/plans .ai/research | grep -iE 'integration|ramp|xero|onshape|oee|jira|linear|mount|paperless|stripe|rillet|sense|slack|gmail'`.
11. Add a "Design history" table. It has one row per integration and links each spec, plan and research file.

**Verify:** the rule-file check in the common procedure.

**Out of scope:** changes to integration code. Do not rename or move any file.

## Task 2: Create the Mount rule

**Depends on:** none
**Files:**
- Create: `.claude/rules/mount-integration.md`
- Modify: `AGENTS.md` — add the row "Mount integration (quality, publish actions)".
- Copy from (precedent): `.claude/rules/jira-integration.md`

**Steps:**
1. Read all 20 files under `packages/ee/src/mount/`.
2. Read `apps/erp/app/routes/api+/integrations.mount.publish.ts`.
3. Find the Inngest functions: `grep -rln mount packages/jobs/src`.
4. Record the settings schema (`MountSettingsSchema` in `config.tsx`) and `MOUNT_PUBLISH_ACTION_IDS`.
5. Record what Carbon sends to Mount, the trigger for each publish, and the Mount objects it writes.

**Verify:** the rule-file check in the common procedure.

**Out of scope:** the user docs page (Task 8).

## Task 3: Create the Paperless Parts rule

**Depends on:** none
**Files:**
- Create: `.claude/rules/paperless-parts-integration.md`
- Modify: `AGENTS.md` — add the row "Paperless Parts integration (quotes into sales orders)".
- Copy from (precedent): `.claude/rules/jira-integration.md`

**Steps:**
1. Read the 7 files under `packages/ee/src/paperless-parts/`.
2. Read the Paperless Parts exports in `packages/ee/src/index.ts` (the comment at line 355).
3. Find the webhook route and the jobs: `grep -rln -i paperless apps/erp/app/routes packages/jobs/src`.
4. Run `git log --oneline --since=2026-10-02 -- packages/ee/src/paperless-parts`. Record each behavior change from these commits.

**Verify:** the rule-file check in the common procedure.

**Out of scope:** `estimating.mdx` (Task 14).

## Task 4: Create the Slack rule

**Depends on:** none
**Files:**
- Create: `.claude/rules/slack-integration.md`
- Modify: `AGENTS.md` — add the row "Slack integration (assistant, notifications, workflow step)".
- Copy from (precedent): `.claude/rules/jira-integration.md`

**Steps:**
1. Read `packages/ee/src/slack/` (6 files) and `packages/ee/src/slack.server.ts`.
2. Record the gate `CONTROLLED_ENVIRONMENT === false`. Write which deployments it hides Slack from.
3. Record how the assistant gets Slack messages. Link `.claude/rules/chat-ai-sdk-info.md` for the assistant itself.
4. Record how a workflow uses Slack. Link `.claude/rules/workflow-integrations.md` for the workflow piece.

**Verify:** the rule-file check in the common procedure.

**Out of scope:** the AI chat internals.

## Task 5: Create the email and Google rule

**Depends on:** none
**Files:**
- Create: `.claude/rules/email-integrations.md`
- Modify: `AGENTS.md` — add the row "Email, Gmail and Google Calendar integrations".
- Copy from (precedent): `.claude/rules/jira-integration.md`

**Steps:**
1. Read `packages/ee/src/email/` (4 files), `packages/ee/src/gmail/config.tsx` and `packages/ee/src/google-calendar/config.tsx`.
2. Read `packages/ee/src/email-notifications/`. Write how it differs from the `email` integration.
3. Record the shared gate `!!GOOGLE_CLIENT_ID`.
4. Write which features send mail through Resend and which send through Gmail.
5. Link `.claude/rules/email-design.md` for templates.

**Verify:** the rule-file check in the common procedure.

**Out of scope:** email template design.

## Task 6: Refresh the existing integration rules

**Depends on:** none
**Files (one subagent for each row):**

| Rule file | Code paths for `git log` | Since |
|---|---|---|
| `.claude/rules/xero-webhooks.md` | `packages/ee/src/xero` | 2026-09-26 |
| `.claude/rules/workflow-integrations.md` | `packages/ee/src/integrations packages/ee/src/workflows` | 2026-10-28 |
| `.claude/rules/ramp-integration.md` | `packages/ee/src/ramp packages/ee/src/spend` | 2026-10-17 |
| `.claude/rules/xero-api-contact-structure.md` | `packages/ee/src/xero` | 2026-10-13 |
| `.claude/rules/accounting-sync-handlers.md` | `packages/ee/src/accounting packages/ee/src/sync packages/ee/src/xero packages/ee/src/rillet` | 2026-11-04 |
| `.claude/rules/oee-provider.md` | `packages/ee/src/oee packages/ee/src/sense` | 2026-11-04 |
| `.claude/rules/onshape-panel.md` | `packages/ee/src/onshape` | 2026-11-11 |
| `.claude/rules/jira-integration.md` | `packages/ee/src/jira packages/ee/src/issue-sync` | 2026-11-04 |
| `.claude/rules/linear-integration.md` | `packages/ee/src/linear packages/ee/src/issue-sync` | 2026-11-04 |
| `.claude/rules/issue-sync.md` | `packages/ee/src/issue-sync` | 2026-11-04 |

**Steps (for each row):**
1. Run `git log -p --since=<Since> -- <Code paths>`.
2. For each behavior change in the diff, find the rule text that describes it.
3. If the rule text is wrong, correct it.
4. If the rule does not mention a new behavior, add one line under the correct section.
5. Grep every function name in the rule. Correct or remove each name that `grep` does not find.
6. Keep human-written warnings and explanations.
7. If the diff has no behavior change, do not edit the file. Report "no drift".

**Verify:** the rule-file check in the common procedure, for each edited file.

**Out of scope:** rewrites of a rule's structure. Do not shorten `ramp-integration.md` (1056 lines) or `accounting-sync-handlers.md` (889 lines) in this plan.

## Task 7: Refresh the Stripe Connect AGENTS.md (after D2)

**Depends on:** the Stripe Connect branch merged into `main`
**Files:**
- Modify: `packages/ee/src/stripe-connect/AGENTS.md`
- Modify: `packages/stripe/AGENTS.md` — the Connect section only.

**Steps:**
1. Follow `.claude/skills/create-agents-md/SKILL.md` Step 3 ("If refreshing").
2. Read `packages/ee/src/stripe-connect/` and `packages/stripe/src/connect.server.ts` on `main`.
3. Add a row "Stripe Connect (invoice payments, Express accounts)" to the root `AGENTS.md` router.

**Verify:** the "Done when" list in `.claude/skills/create-agents-md/SKILL.md`. Every box is ticked.

**Out of scope:** the Stripe billing docs (`.claude/rules/billing-system.md`).

## Task 8: Create the Quality page for Mount

**Depends on:** Task 2 is useful as input, but not required.
**Page type:** Settings / how-to (300–600 words).
**Files:**
- Create: `docs/content/docs/integrations/quality.mdx`
- Copy from (precedent): `docs/content/docs/integrations/estimating.mdx`

**Steps:**
1. Use the frontmatter `title: Quality`, `plan: Business` and a one-line `description`.
2. Write 1–2 lead sentences about what Mount does with Carbon data.
3. Write a `<Steps>` block from the `SetupInstructions` component in `packages/ee/src/mount/`.
4. Write a short section for each publish action in `MOUNT_PUBLISH_ACTION_IDS`.
5. Put the settings fields in a table. Take them from `MountSettingsSchema`.

**Verify:** the page check in the common procedure. Expected word count: 300–600.

**Out of scope:** the Mount API itself.

## Task 9: Create the Spend management page for Ramp

**Depends on:** none
**Page type:** Concept / overview (150–300 words).
**Files:**
- Create: `docs/content/docs/integrations/spend-management.mdx`
- Copy from (precedent): `docs/content/docs/integrations/assistant.mdx`

**Steps:**
1. Summarize what Ramp syncs. Take the facts from `docs/content/docs/integrations/setup/ramp.mdx` and `.claude/rules/ramp-integration.md`.
2. Link to `/docs/integrations/setup/ramp` for the connect steps.
3. Do not copy the setup steps into this page.

**Verify:** the page check in the common procedure. Expected word count: 150–300.

**Out of scope:** changes to `setup/ramp.mdx` (Task 14).

## Task 10: Remove QuickBooks from the accounting page (D1)

**Depends on:** D1 confirmed
**Files:**
- Modify: `docs/content/docs/integrations/accounting.mdx` — remove QuickBooks from lines 3, 6, 18, 22, 28 and from every other line that names it.

**Steps:**
1. Run `grep -n -i quickbooks docs/content/docs/integrations/accounting.mdx`.
2. Rewrite each line so that it names only Xero and Rillet.
3. Run `grep -rn -i quickbooks docs/content/docs`. Edit each other active page that names QuickBooks.
4. If a page names QuickBooks only in `<AgentContext>`, remove that text too.

**Verify:**
```bash
grep -rn -i quickbooks docs/content/docs
# Expected: no output
```

**Out of scope:** `packages/ee/src/quickbooks/`. Do not change `active`.

## Task 11: Create the Linear setup guide

**Depends on:** none
**Page type:** Settings / how-to (300–600 words).
**Files:**
- Create: `docs/content/docs/integrations/setup/linear.mdx`
- Copy from (precedent): `docs/content/docs/integrations/setup/jira.mdx`

**Steps:**
1. Use the same sections as `setup/jira.mdx`, in the same order.
2. Take the steps from the `setupInstructions` component in `packages/ee/src/linear/config.tsx`.
3. Write a self-hosting section at the end, the same as the other setup guides.
4. Link back to the Linear section of `project-management.mdx`.

**Verify:** the page check in the common procedure. Expected word count: 300–600.

**Out of scope:** changes to `project-management.mdx` other than one link to this guide.

## Task 12: Create the Rillet setup guide

**Depends on:** none
**Page type:** Settings / how-to (300–600 words).
**Files:**
- Create: `docs/content/docs/integrations/setup/rillet.mdx`
- Copy from (precedent): `docs/content/docs/integrations/setup/xero.mdx`

**Steps:**
1. Use the same sections as `setup/xero.mdx`, in the same order.
2. Write that Rillet uses a per-company API key, not OAuth (`accounting.mdx:22`).
3. Take the fields from `packages/ee/src/rillet/config.tsx`: the API key and the two hosts `api.rillet.com` and `sandbox.api.rillet.com`.
4. Link back to the connect section of `accounting.mdx`.

**Verify:** the page check in the common procedure. Expected word count: 300–600.

**Out of scope:** the accounting sync internals.

## Task 13: Update the integration index pages and navigation

**Depends on:** Tasks 8, 9, 11, 12
**Files:**
- Modify: `docs/content/docs/integrations/meta.json` — add `"quality"` and `"spend-management"` to `pages`.
- Modify: `docs/content/docs/integrations/index.mdx` — add a "Quality" card and a "Spend management" card under "Browse by category".
- Modify: `docs/content/docs/integrations/setup/meta.json` — add `"linear"` and `"rillet"`.
- Modify: `docs/content/docs/integrations/setup/index.mdx` — add cards for Linear and Rillet. Add cards that link Paperless Parts, Sense, Gmail and Mount to their category pages. Update `description` to name every app on the page.

**Steps:**
1. Copy the card shape that each file already uses.
2. Keep the category order in `meta.json` the same as the card order in `index.mdx`.

**Verify:**
```bash
pnpm --filter @carbon/content test
# Expected: all tests pass, including links.test.ts
```

**Out of scope:** the docs site sidebar component.

## Task 14: Refresh the existing integration pages

**Depends on:** none
**Files (one subagent for each row):**

| Page | Code paths for `git log` | Since |
|---|---|---|
| `estimating.mdx` | `packages/ee/src/paperless-parts` | 2026-10-02 |
| `accounting.mdx` | `packages/ee/src/xero packages/ee/src/rillet packages/ee/src/accounting` | 2026-10-28 |
| `cad.mdx` | `packages/ee/src/onshape` | 2026-11-10 |
| `workflow-apps.mdx` | `packages/ee/src/integrations packages/ee/src/workflows` | 2026-10-28 |
| `oee.mdx` | `packages/ee/src/sense packages/ee/src/oee` | 2026-11-04 |
| `setup/ramp.mdx` | `packages/ee/src/ramp` | 2026-10-28 |
| `setup/jira.mdx` | `packages/ee/src/jira` | 2026-10-28 |
| `setup/xero.mdx` | `packages/ee/src/xero` | 2026-10-28 |
| `setup/slack.mdx` | `packages/ee/src/slack packages/ee/src/slack.server.ts` | 2026-10-28 |
| `email.mdx` | `packages/ee/src/email packages/ee/src/gmail` | 2026-11-02 |
| `project-management.mdx` | `packages/ee/src/jira packages/ee/src/linear` | 2026-11-04 |

All pages are under `docs/content/docs/integrations/`.

**Steps (for each row):**
1. Run `git log -p --since=<Since> -- <Code paths>`.
2. Keep only the changes that a user can see: a setting, a step, a label, a status or an error message.
3. Correct each sentence that the diff makes wrong.
4. Add each new visible behavior to the section that owns it.
5. Keep the page type and its shape.
6. If the diff has no visible change, do not edit the page. Report "no drift".

**Verify:** the page check in the common procedure, for each edited page.

**Out of scope:** new sections that the diff does not need.

## Task 15: Create the Payments page for Stripe Connect (after D2)

**Depends on:** D2 resolved, and Stripe Connect enabled on Carbon Cloud
**Page type:** Settings / how-to (300–600 words).
**Files:**
- Create: `docs/content/docs/integrations/payments.mdx`
- Modify: `docs/content/docs/integrations/meta.json` and `index.mdx` — add the page and its card.
- Copy from (precedent): `docs/content/docs/integrations/estimating.mdx`

**Steps:**
1. Take the steps from the `setupInstructions` component in `packages/ee/src/stripe-connect/config.tsx`.
2. Write how a customer pays a sales invoice, and where the payment shows in Carbon.
3. Write how to open the Stripe dashboard (`api+/integrations.stripe-connect.dashboard.ts`).

**Verify:** the page check in the common procedure. Then run `pnpm --filter @carbon/content test`. Expected: all tests pass.

**Out of scope:** the Stripe billing docs.

## Task 16: Verify the docs site and the agent knowledge base

**Depends on:** every task that you run
**Files:** none

🛑 Do not stop, restart or build under the user's running docs dev server.

**Steps:**
1. Run the `@carbon/content` checks.
2. If the user's docs dev server runs, fetch each new and edited page from it.
3. If no dev server runs, run the docs build.
4. Do the STE-80 review pass on each new rule file (`.claude/rules/writing-ste.md` → "The review pass").

**Verify:**
```bash
pnpm --filter @carbon/content typecheck
pnpm --filter @carbon/content test
pnpm --filter @carbon/content lint
# Expected: each command exits 0
pnpm --filter docs build
# Expected: "✓ Generating static pages N/N"; no MDX error
```

**Out of scope:** a commit. Use `/check-and-commit` only when the user asks.

## Task 17: Make the existing rules auto-load for their code

**Depends on:** none
**Files:**
- Modify: `.claude/rules/accounting-sync-handlers.md` — add `"packages/ee/src/sync/**"`, `"packages/ee/src/xero/**"` and `"packages/ee/src/rillet/**"` to `paths:`.
- Modify: `.claude/rules/xero-webhooks.md` — add `"packages/ee/src/xero/**"` to `paths:`.
- Modify: `.claude/rules/xero-api-contact-structure.md` — if `packages/ee/src/xero/hooks.server.ts` touches contacts, add `"packages/ee/src/xero/**"` to `paths:`.

**Steps:**
1. Open each file. Add each glob in the same quote style as the existing lines.
2. Do not remove a glob.
3. Run the coverage script below.

**Verify:**
```bash
python3 -I - <<'PY'
import glob,re,os
fm={os.path.basename(f):(re.match(r'---\n(.*?)\n---',open(f).read(),re.S) or [None,''])[1] for f in glob.glob('.claude/rules/*.md')}
for d in "email gmail mount paperless-parts slack stripe-connect xero rillet sync".split():
    hit=[r for r,t in fm.items() if re.search(r'packages/ee/src/'+re.escape(d)+r'\b',t)]
    print(d, hit or 'NONE')
PY
# Expected after Tasks 2-5, 7 and 17: no line ends in NONE
```

**Out of scope:** changes to rule text. Task 6 handles the text.

## Task 18: Add a check for integrations with no rule (after D5)

**Depends on:** D5 confirmed; Tasks 1–5, 7 and 17
**Files:**
- Create: `packages/checks/src/conformance/integration-has-rule.ts`
- Create: `packages/checks/src/conformance/integration-has-rule.test.ts`
- Modify: `packages/checks/src/run.ts` — add the check to `STRUCTURE_CHECKS` (line 172).
- Modify: `packages/checks/src/index.ts` — export the check.
- Modify: `packages/checks/AGENTS.md` — add one line under "Structure checks".
- Copy from (precedent): `packages/checks/src/conformance/module-shape.ts` and `module-shape.test.ts`

**Steps:**
1. Read `module-shape.ts` and the `StructureCheck` type in `run.ts`.
2. List each directory under `packages/ee/src/` that has a `config.tsx` that calls `defineIntegration`.
3. Skip each integration whose config has `active: false`.
4. Read the `paths:` frontmatter of every `.claude/rules/*.md` file.
5. Report a finding for each listed directory that no `paths:` glob matches.
6. Write the finding message: "`packages/ee/src/<dir>` is a registered integration with no rule. Add `.claude/rules/<dir>-integration.md` with a `paths:` glob for it."
7. Write 3 tests: a covered directory passes, an uncovered directory fails, and an `active: false` directory passes.
8. Run the license-header fixer on the 2 new files.

🛑 Do not add a baseline entry. Tasks 1–5, 7 and 17 remove every current finding.

**Verify:**
```bash
pnpm --filter @carbon/checks license-headers packages/checks/src/conformance/integration-has-rule.ts packages/checks/src/conformance/integration-has-rule.test.ts
pnpm --filter @carbon/checks test
pnpm exec turbo run typecheck --filter=@carbon/checks
# Expected: each command exits 0; the new tests pass
```

**Out of scope:** a check for user docs pages. User pages depend on plan gates and on D1-type decisions that a check cannot read.
