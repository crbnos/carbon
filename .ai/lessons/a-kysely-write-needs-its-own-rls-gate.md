---
paths: ["packages/database/src/authz/**", "packages/checks/src/clobber.ts", "packages/database/src/datasets/wipe.ts"]
triggers: ["requireMaterialUpdatable", "db: Kysely<KyselyDatabase>", "OBJECT_PATTERNS", "assertWipeable", "authz migration"]
promoted: null
---
# A Kysely write needs its own RLS gate

**Context:** Material property edits write the material row, every revision's
item row and `itemCost` in one Kysely transaction.

**Problem:** Kysely connects as the Postgres role and bypasses RLS, so a caller
without `parts_update` in the company, or naming another company's material,
would still write.

**Rule:** Before a Kysely transaction on rows a caller names, run one UPDATE
through the caller's supabase client, filtered by id and `companyId`, with
`.select().single()`, and stop on its error (`requireMaterialUpdatable`). Pick
a row whose policy also covers the other rows the transaction writes.

**Applies to:** any service that takes both `client` and `db` and writes with
`db` on behalf of an API or MCP caller.

---

**Context:** Merging `origin/main` into a branch that had renamed `cardTransaction`
→ `charge` and added three `reimbursement*` tables, after main moved RLS into the
declarative manifest (`packages/database/src/authz/`).

**Problem:** Nothing in the textual merge mentions the manifest, so the merge looks
clean and the branch's own migrations still create correct policies. The breakage
surfaces later and in three different places: `crbn migrate` aborts with `authz
rules that do not apply: cardTransaction: relation "public.cardTransaction" does
not exist` (the manifest still declares the OLD name), `authz check` reports the
new tables as `unmanaged`, and `@carbon/database`'s `migration.test.ts` fails in CI
on `unshipped` because production reaches RLS only through a generated migration —
deploy does NOT run `authz sync` (nothing in `ci/src/migrations.ts` or
`.github/workflows/` calls it). A branch that renames a table also strands its
`baseline.json` entry, which must NOT be regenerated.

**Rule:** When a branch renames or adds a table, treat `packages/database/src/authz/manifest.ts`
as part of the schema change: rename/add the entry, then
`pnpm --filter @carbon/database authz migration <name>` (it scopes itself to the
unshipped set — it will not sweep up unrelated drift), then `authz check` until it
reports 0 tables. Verify a hand-written policy and its manifest entry agree by
rendering both rather than reading them: alias (`p` vs `h`), the enum cast Postgres
adds, and an omitted `WITH CHECK` on UPDATE are all cosmetic, but a missing clause
is not. A two-hop parent check needs `custom()` — nested `exists()` aliases its
parent `p`, so the intermediate table has no name to reference.

**Applies to:** every in-flight worktree that adds or renames a table and then
merges main; `packages/database/src/authz/**`.

---

**Context:** The same merge: `pnpm --filter @carbon/checks clobbers` reported
`function:public` redefined on both sides, naming two migrations whose functions
were `check_charge_*` and `update_receipt_line_batch_tracking` — no overlap at all.

**Problem:** `clobber.ts`'s patterns captured the first identifier after `FUNCTION`
/ `VIEW`, so `public.foo` keyed as `function:public`. Two unrelated schema-qualified
definitions therefore always collided, and — the half that actually matters — two
redefinitions of the SAME qualified function were never keyed by its name, so a
genuine clobber went unreported. A check that cries wolf on every merge is a check
people learn to pass with `--no-verify`.

**Rule:** Key a DB object by its OBJECT name with the `schema.` qualifier
discarded (`public.foo` and a bare `foo` ARE the same object — `public` is the
default search path). When a conformance check fires, confirm the two sides really
do name the same object before rebasing; a vague key like `function:public` is
evidence about the check, not about the migrations.

**Applies to:** `packages/checks/src/clobber.ts` and any future `OBJECT_PATTERNS` row.

---

**Context:** Immediately after that merge, `crbn reset` failed with
`relation "cardTransaction" does not exist` from `assertWipeable`
(`datasets/wipe.ts`) — a function that did not exist at the merge-base and was
added by main while this branch was renaming that table to `charge`.

**Problem:** Neither side edited the other's lines, so git merged it with no
conflict and every gate stayed green. `pnpm db:check:datasets` does NOT cover it:
`verifyDataset` seeds a SCRATCH company with `wipeFirst: false`, so the wipe — and
`assertWipeable` with it — never runs. Only a real `db:seed:dev` / `crbn reset`
reaches that path, which is exactly the step nobody runs while resolving a merge.
Typecheck cannot see it either: the table name is a string inside `client.query`.

**Rule:** After merging main into a branch that RENAMED a database object, grep the
files MAIN changed for the OLD identifier — `git diff --name-only <merge-base>
origin/main` piped into a grep for the old name — instead of trusting a clean merge
or a green `db:check:datasets`. Exclude `supabase/migrations/**` (history),
`authz/baseline.json` (what production had, never regenerated) and
`jobs/src/backups/renames.ts` (the old→new restore map): all three are SUPPOSED to
keep the old name. Then run the seed itself. Docs count as hits too — main's new
`assertWipeable` paragraphs in `datasets/AGENTS.md` and
`.claude/rules/onboarding-company-templates.md` named the old table as well.

**Applies to:** any branch that renames a table, column or enum value and then
merges main; `packages/database/src/datasets/wipe.ts` above all, since no automated
gate executes it.
