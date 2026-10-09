# Feature run: Generated avatars (DiceBear Croodles Neutral)

- Date: 2026-10-08
- Mode: fully-autonomous
- Request: "i wanna implement the https://www.dicebear.com/introduction/ for the user so they can set it from this and can upload their own just like before, it will automatically create a randome avatar when new user signs up. and use Croodles Neutral from the dicebear"
- Phase plan: research [skip — not ERP-domain logic, and the request is clear] · spec [run — the change touches the DB, 3 apps, `@carbon/react` and the invite flows] · plan [run] · execute [run] · test [skip — the user chose no browser test and verifies by hand] · self-review [run]

## Decisions
- Plan approval gate: approved — every task maps to a spec criterion, and the plan has no schema change beyond one column default — 2026-10-08
- Picker location: ERP profile module, not `@carbon/react` — only the ERP uses it, and a barrel change is Ask-First in `packages/react/AGENTS.md` — 2026-10-08
- Mode and phases: fully autonomous, spec → plan → execute → self-review — user answer — 2026-10-08
- Avatar source: bundled `@dicebear/core@9` + `@dicebear/croodles-neutral@9`, not the HTTP API — user answer (this approves the new production dependencies) — 2026-10-08
- Existing users: no backfill. Only new users get a generated avatar — user answer — 2026-10-08
- Remove photo: switch to a new random generated avatar — user answer — 2026-10-08
- Commits: execute does NOT commit. The user's standing rule says "never commit without an explicit ask". The work stays uncommitted for review — 2026-10-08
- Local database: execute does NOT apply the migration. The user's standing rule says "no DB writes without asking". The column default does not change the generated types — 2026-10-08
- Avatar background: a color that contrasts with the theme, black on the light theme and white on the dark theme. This replaces the 5 pastel colors. `Avatar` applies it with `bg-white invert dark:invert-0` — user request — 2026-10-08
- Avatar styles: a style select with 10 styles (user request). DiceBear moves from 9 to 10, because Loops, Voxel Art, Voxel Bot and Planets exist only in version 10. New users keep Croodles Neutral — 2026-10-08
- Line-art avatars: black lines on white in both themes, no invert — user request — 2026-10-08
- Background color: user picks one per avatar with the ERP `ColorPicker`; stored as an optional `:<rrggbb>` value segment; dark backgrounds switch the neutral line styles to white ink — user request — 2026-10-08
- Server-drawn avatars: a public `/file/avatar/:value` route in each app renders the SVG with DiceBear and caches it as immutable; `Avatar` uses it, the picker still draws in the browser — user approved the route after a slow-refresh report — 2026-10-08
- New users: no generated avatar by default; initials as before. the draft migration `20261008113405` is deleted (user: the PR is not merged, so no migration at all); a development database that ran it drops the default and its migration record by hand — user decision — 2026-10-08

## Phase log
- spec: written at `.ai/specs/2026-10-08-dicebear-avatars.md`. All 4 questions answered by the user before writing. STE-80 pass done.
- plan gate: auto-approved (autonomous mode). Plan at `.ai/plans/2026-10-08-dicebear-avatars.md`. STE-80 pass done.

- execute: Tasks 1–8 done, not committed. Gates: Biome clean on the changed files. Typecheck passes for `@carbon/utils`, `@carbon/react`, `erp`, `mes` and `academy`. Tests: `@carbon/utils` 611/611, `@carbon/react` 57/57, `@carbon/checks` 278/278. The DB invariants script did not run, because it needs `DATABASE_URL`.
- self-review: done. One stale doc line fixed (`account.mdx`). The other findings went to the user.
- self-review 2 (user asked to fix): 5 findings fixed. (1) The action now saves first, then deletes the replaced upload; the client deleted before the save. (2) The early "Photo removed" toast is gone. (3) The 5 picker strings are in the 13 `erp.po` catalogs, translated. (4) `Avatar` retries a new `src` after a failure. (5) `isAllowedAvatarValue` / `isOwnAvatarUpload` are in `@carbon/utils` with tests. Gates: Biome clean; typecheck passes for 6 tasks (`@carbon/utils`, `@carbon/react`, `erp`, `mes`, `academy`); tests `@carbon/utils` 614/614, `@carbon/react` 60/60. Not fixed: a database guard on `avatarUrl` (Ask-First, schema on `user`).
- styles: done. `@dicebear/core@10.7.0` + `@dicebear/styles@10.6.0` replace the 9.4.2 packages. Each style is a lazy chunk. Gates: Biome clean on the changed files; typecheck passes for 6 tasks; tests `@carbon/utils` 616/616, `@carbon/react` 71/71; 3 new strings translated in 12 locales.

- background color: done. Gates: Biome clean on changed files; typecheck passes for 6 tasks; tests `@carbon/utils` 620/620, `@carbon/react` 74/74; 2 new strings translated in 12 locales.

- self-review 3 (user asked to fix the must-fix and suggestions): the DiceBear core loads lazily (renderer entry 2.5 KB in a split bundle); `generatedAvatarClassName` and `avatarSrc` extracted with tests; the order-dependent test isolated with `vi.resetModules`; the profile action has 6 tests (a delete-before-save mutation fails 4 of them). Docs: 2 lessons, both AGENTS notes, the spec.

- self-review 4: image helpers split into `generatedAvatarImage.ts` (Avatar bundle 3.4 KB, no DiceBear); version constant in tests; regression test against JSON import attributes (mutation fails it); spec updated for the route.

## Outcome
- Uncommitted on `naveenkash/75pu7`. The migration is not applied. The user commits and applies it.
