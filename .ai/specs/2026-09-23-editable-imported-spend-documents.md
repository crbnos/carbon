# Editable Imported Spend Documents — Charges (and Reimbursements)

> Status: draft
> Author: Brad Barbin + Claude
> Date: 2026-09-23
> Reference UI: Rillet's Charge and Reimbursement screens (screenshots reviewed 2026-09-23).
> Sibling spec: `.ai/specs/2026-09-23-reimbursements-first-class.md` — reimbursements adopt
> this same editing model; that spec owns their data model, this one owns the shared shape.
> Related: `.claude/rules/ramp-integration.md` (inbound sync, `post-charge`),
> `.ai/specs/2026-09-19-ramp-integration.md`.

## TLDR

A `charge` arrives from a spend provider (Ramp) and is posted immediately today, so a human
never sees it in an editable state and its coding is whatever the provider sent. This spec
makes an imported spend document **land as Draft, be editable in Carbon — header and coding
lines, including adding and removing lines — and post only when a human is satisfied**. It
also makes the originating provider **first-class in the UI**: its logo, its external id, and
an Activity entry recording the import. Carbon still never *creates* these documents by hand;
they are always records of something that happened in the spend tool. Reimbursements adopt the
identical model.

## Problem Statement

### 1. There is no editable moment

`ramp-sync` stages a Draft `charge` and immediately invokes `post-charge`, so the row is
`Posted` — and therefore immutable (the lifecycle trigger allows only Draft edits) — before
anyone in Carbon has looked at it. If Ramp's coding is wrong, absent, or coded to an account
that does not suit Carbon's chart, the only remedies are to void and re-create, or to fix it
in Ramp and re-sync. Neither is what an accountant expects.

### 2. Coding cannot be corrected or enriched in Carbon

`chargeLine` already carries `accountId`, `costCenterId`, `projectId`, `description` and
`amount`, but nothing in the UI can write them — the charge detail route is read-only and
there is no line editor anywhere. So Carbon holds a document whose dimensional coding it
cannot improve, while being the system that owns cost centers and projects.

### 3. Provenance is invisible

`charge.integration` records `'ramp'`, but the UI never shows it. A user cannot tell an
imported charge from any other, cannot see the provider's own identifier for it, and has no
record of when it arrived. Rillet, by contrast, renders the source provider's **logo** as a
labelled `SOURCE` field, shows the external id, and writes an Activity line ("Charge imported
from BREX"). That is the bar.

## Proposed Solution

### Lifecycle: import as Draft, code, then post

| Step | Actor | State |
|---|---|---|
| Sync imports the charge with whatever coding the provider sent | `ramp-sync` | **Draft** |
| Review: correct the header, correct/add/remove coding lines | human, in Carbon | Draft (editable) |
| Post | human | **Posted** (immutable; journal written) |
| Sync onward to the accounting provider | posting sync | — |

This is the one behavioural change to the existing flow: **the sync no longer auto-posts.**
Draft is the review queue. The lifecycle trigger already permits exactly this (Draft edits
allowed, Posted immutable), so no trigger change is needed.

### Editing

Cloning the reference UI's two-mode shape:

- **Read mode** — header card (party, amounts, dates, currency, and the SOURCE badge), a
  Line Items table, and a right rail with Activity.
- **Edit mode** — a `Details` card of editable header fields, and a `Line items` card with
  `+ Add line item` (top and bottom), expand/collapse per line, per-line delete, and a
  **running total in the page header** so the user sees the sum against the document amount
  as they type.

The header total must reconcile to the line sum before Post is allowed — `post-charge`
already refuses a `Charge`/`Credit` whose lines do not sum to the header, so the UI surfaces
that invariant rather than inventing one.

### Source attribution, first-class

On the detail header, a labelled **SOURCE** field showing the provider's **logo** and name,
plus the provider's external id beneath it. The logo comes from the integration registry the
settings page already renders (`packages/ee` `integrations[]`), so a new provider gets its
badge with no extra work. An **Activity** entry records `"{Document} imported from {Provider}"`
with the import timestamp.

### Line fields (v1)

`chargeLine` already has the columns, so **v1 needs no migration**:

| Field | Required | Notes |
|---|---|---|
| Account | yes | the GL account the line codes to |
| Amount | yes | lines must sum to the header |
| Description | no | |
| Cost Center | no | already a column; becomes a `journalLineDimension` at post |
| Project | no | already a column; becomes a `journalLineDimension` at post |

The reference UI exposes a much wider dimension set (Department, Location, Asset Class,
Supplier, Item, Customer, Supplier Type, Employee, Work Center, Process, Item Posting Group,
Service Period). Those are **deliberately out of v1**: Carbon models analytical dimensions
through its own `dimension` / `journalLineDimension` system rather than a column per concept,
so the right way to reach that breadth is to render the company's configured dimensions
generically — not to add fourteen columns to `chargeLine`. Recorded as the follow-up below.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Authoring | **Still never created by hand** | These documents record something that happened in the spend tool; hand-entering one invents a transaction with no counterpart. Import-then-edit is a different thing from create. |
| Sync auto-post | **Stop auto-posting; import as Draft** | Without a Draft window there is no editable moment at all. Draft becomes the review queue. |
| Editable scope | Header + lines, **while Draft only** | Matches the existing lifecycle trigger exactly (Draft edits allowed, Posted immutable) — no trigger change, and posted history stays immutable. |
| Line dimensions v1 | Account, Amount, Description, Cost Center, Project | Exactly the columns `chargeLine` already has, so v1 needs no migration. |
| Wider dimensions | **Deferred**, and then via the generic `dimension` system | A column per Rillet concept would fight Carbon's dimension model and need a migration per concept. |
| Source attribution | Provider logo + name + external id + Activity entry | `charge.integration` already stores the provider; the logo comes from the existing integration registry, so new providers are free. |
| Totals guard | Header total must equal the line sum before Post | Surfaces the invariant `post-charge` already enforces, rather than failing at post time. |
| Detail surface | **Full page, not the Drawer** | Carbon's convention is Drawer detail views, but a multi-line editor with expandable per-line forms does not fit a drawer. This is a deliberate, narrow exception — flagged rather than silently broken. |

## Data Model Changes

**None for charges in v1.** `charge` and `chargeLine` already carry every field the editor
writes, `charge.integration` already records the provider, and the lifecycle trigger already
allows Draft edits.

Reimbursements get their tables from the sibling spec; they must mirror `chargeLine`'s shape
(`accountId`, `costCenterId`, `projectId`, `description`, `amount`, `sequence`).

## API / Service Changes

- `invoicing.service.ts` — `updateCharge` (header) and `upsertChargeLines` / `deleteChargeLine`,
  all refusing a non-Draft parent. Line writes are multi-row, so the Kysely client is built in
  a `.server` helper and passed in from the route action — never constructed in the service
  file (it is barrel-exported to the browser).
- `ramp-sync-card.ts` — stop invoking `post-charge` on import; leave the row Draft.
- A route action to Post a Draft charge (invoking the existing `post-charge` edge function),
  which is what the sync used to do implicitly.

## UI Changes

- `charges.$id.tsx` — read mode: header card with the SOURCE badge (logo + name + external id),
  Line Items table, Activity rail.
- `charges.$id.edit.tsx` (or an edit mode on the same route) — Details card + Line items editor
  with Add/remove, expand/collapse, running total, Cancel/Save.
- A **Post** action on a Draft charge.
- Precedent to clone: `apps/erp/app/modules/invoicing/ui/Charge/` for the table and status,
  and the memo detail/edit routes for the action + flash conventions.

## Acceptance Criteria

- [ ] A Ramp-imported charge lands **Draft**, not Posted, and appears in the charges list as
      Draft.
- [ ] Its detail page shows a **SOURCE** field with the Ramp **logo**, the provider name, and
      the provider's external id, plus an Activity entry "Charge imported from Ramp".
- [ ] Edit mode allows changing header fields and editing an existing line's account, amount,
      description, cost center and project; Save persists all of it.
- [ ] `+ Add line item` adds a second coding line; the running total in the header updates as
      amounts are typed; removing a line updates it too.
- [ ] Post is refused (with a clear message, before any edge-function call) while the line sum
      does not equal the header amount.
- [ ] Posting a fully-coded Draft charge writes the journal with a `journalLineDimension` per
      line carrying its cost center / project, and flips the row to Posted.
- [ ] A **Posted** charge is not editable — edit controls are absent and a direct action is
      refused (the lifecycle trigger is the backstop, not the only guard).
- [ ] Browser-verified end to end via `/test`: import → edit → add line → post.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Not auto-posting changes existing behaviour** — charges that used to post themselves now wait for a human | High | This is the point of the spec, but it is a real workflow change for anyone relying on the current flow. Call it out in the rule and the PR; consider a per-company setting only if a customer actually objects. |
| Drafts pile up unreviewed, so spend never reaches the GL | Med | The charges list defaults to showing Drafts first; the existing Sync Activity tab already surfaces failures. A reviewer queue is the follow-up if volume warrants. |
| A full-page detail diverges from Carbon's Drawer convention | Med | Deliberate and documented above; the line editor does not fit a drawer. |
| Line editor has no precedent in the ERP | Med | Build it as a reusable component from the start, since reimbursements need exactly the same one. |
| Editing a charge already synced onward to the accounting provider | Med | Only Draft rows are editable, and a Draft has not synced — the posting sync fires on Posted. So this cannot arise while the Draft guard holds. |

## Open Questions

- [ ] **Does the sync stop auto-posting for every provider, or only where coding is delegated
      to Carbon?** Why it matters: a customer who codes fully in Ramp gains nothing from a
      Draft queue and may experience it as a regression. Recommended: stop auto-posting
      unconditionally for v1 (simplest, one behaviour), and revisit if a customer wants
      auto-post-when-fully-coded.
- [ ] **Full page vs Drawer for the detail surface** — recommended full page, since the line
      editor does not fit a Drawer, but it is a deliberate break from the house convention and
      worth an explicit yes.

## Changelog

- 2026-09-23: Created, from a review of Rillet's Charge/Reimbursement UI. Supersedes the
  "read and sync only" narrowing recorded earlier the same day in the reimbursements spec:
  these documents are still never hand-created, but they ARE editable after import.
