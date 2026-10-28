# Extending the Implementation Hub

The hub is one page per person. Carbon staff define each person's page card by
card in a JSON page file; a person without a page sees an empty hub. The hub
grows on **three axes**:

1. **Template** (code, all customers): the hub items in `src/content/*` that a
   page can place (setup items, tasks, product steps, data sets, training,
   cutover steps, requirements).
2. **Per-company** (DB): custom rows (objectives, open questions,
   customizations, custom setup and data items), ticks, tier, exclusions.
3. **Per-person** (DB): the page file in `implementationMember.page`.

## Architecture in one breath

```
content/*   → the template (pure data: steps, rows, copy, registries)
logic/*     → pure functions over template + saved state; logic/page.ts is the
              page catalogue, the page checks and what each card shows
models.ts   → zod validators, including memberPageValidator (the page file)
server.ts   → Supabase reads/writes (the hub layout's loader calls these)
apply-mutation.ts → applyHubMutation: the single write path and its access
              rules (the pure refusalFor); the /state action calls it
ui/state/*  → the zustand store: a SERVER-DRIVEN mirror of loader data + a
              dispatch that round-trips every write to the /state action
ui/MemberPageView.tsx → the page; reads the store via hooks
```

The store is **not** a client cache. The React Router loader is the source of
truth; the store mirrors it and re-hydrates on every revalidation. Writes go
`useHubActions()` → `dispatch` → `/state` action → `applyHubMutation` →
Supabase → realtime revalidate → loader → store. Ticks are applied
optimistically until the loader confirms them.

## The page file

```json
{
  "version": 1,
  "user": "alex@example.com",
  "title": "Alex, Purchasing",
  "sections": [
    { "title": "Next up", "cards": [
      { "item": "setup:suppliers", "due": "2026-10-20" },
      { "item": "task:first-purchase-order", "note": "Start with the blanket order" },
      { "custom": { "key": "approval-limits", "title": "Agree approval limits", "link": "/x/settings/approval-rules" } }
    ]}
  ]
}
```

- `checkMemberPage` (`logic/page.ts`) runs the schema, then `pageProblems`:
  unknown items and cards placed twice. Every problem is listed with its path;
  nothing half-loads. The server runs it again and finds the person by email.
- `buildPageCatalogue(rows)` lists every key a page can place. The app exports
  it from the staff bar.
- A card that places a hub item ticks that item's existing state key, so the
  company shares its progress. A custom card's tick is the person's own
  (`customCardKey(userId, key)`).
- A page names cards by key, so a renamed template item keeps working; a
  removed one shows as "removed from the hub".

## Recipe: make a template item placeable on a page

1. Add it to its `content/*` file with a stable `key`.
2. Add its entry in `templateEntries` (`logic/page.ts`): the catalogue key,
   kind, title, the state it ticks, evidence and links. A new kind also needs
   a `PAGE_CARD_KIND_LABEL` (`content/page.ts`) and, if it ticks something
   new, a label in `CardStatus` (`ui/MemberPageView.tsx`).
3. Add a test in `logic/page.test.ts`.

## Recipe: deep-link a card to an ERP screen

The package can't import the ERP's `path.to`, so screen links are injected.
Map the card's `screenKey` to a screen in
`apps/erp/app/routes/x+/implementation+/_layout.tsx` → `SETUP_SCREEN_PATHS`.
Keys with no entry render with no Open link.

## Recipe: add a nested product step (template)

Add a `NestedProductStep` to the relevant `SPINE` step in `content/spine.ts`.
A step is done only when someone ticks it; detected data never completes it.
To show what Carbon already sees next to it, map its key to setup count keys in
`PRODUCT_STEP_EVIDENCE` (`content/evidence.ts`). If no count fits, add one to
`ONBOARDING_COUNT_KEYS` (`logic/status.ts`) and its query to
`server.ts:getSetupCounts`.

## Recipe: add a sales handover question (template)

1. Add a `HandoverQuestion` to its section in `content/handover.ts`, with a
   new `key` under the section's prefix. Keys are stored (`handover.<key>`),
   so never reuse or rename one.
2. Give it a `destination` only when the answer belongs somewhere in the hub.
   `logic/handover.ts` plans the apply and `apply-handover.ts` runs it; it
   copies each answer once and never overwrites a value someone set. The
   handover has no screen since the per-person redesign; only the
   `applyHandover` intent runs it.

## Conventions

- **Keys are forever.** Build state keys with the helpers in `logic/keys.ts`
  (`gateKey`, `flagKey`, `checkKey`, …); never hand-format one. Catalogue keys
  (`setup:locations`) are forever too: page files store them.
- **Colours/labels** for statuses live in `ui/primitives/tokens.ts`.
- **`canEdit` is UX only.** The `/state` server action is the real authority on
  who may write: page files are Carbon staff only (`refusalFor`).
