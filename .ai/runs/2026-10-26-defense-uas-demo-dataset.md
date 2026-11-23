# Run log — Defense UAS demo dataset

> Spec: `.ai/specs/2026-10-26-defense-uas-demo-dataset.md`
> Plan: `.ai/plans/2026-10-26-defense-uas-demo-dataset.md`
> Branch: `feat/defense-uas-dataset` (not committed — the user commits)

## What ran

| Check | Command | Result |
|---|---|---|
| Pure validator, all five datasets | `validateDataset` per key (the layer-1 check of `db:check:datasets`) | satellite 0, robotics 0, precision 0, motor 0, defense 0 violations |
| Dataset unit tests | `pnpm exec vitest run src/datasets` (in `packages/database`) | 3 files, 14 tests passed |
| Seed workflow definitions | `pnpm --filter @carbon/ee exec vitest run src/workflows/seed-workflows.test.ts` | 44 tests passed (defense included) |
| Typecheck | `pnpm exec turbo run typecheck --filter=@carbon/database --concurrency=1` | 1 successful |
| Typecheck | `pnpm exec turbo run typecheck --filter=erp --concurrency=1` | 2 successful |
| Biome | `pnpm exec biome check <25 changed .ts/.tsx files>` | 0 errors; 3 warnings that predate this branch (`datasets/index.ts:95,116`, `datasets/types.ts` console) |
| Model bake | `plans/quad-model/bake.py isr4-quad 0.5 0.3` against `target/release/assembler` | GLB 2.81 MB, 139 leaves, 21 colours, every leaf in exactly one step |

## What did not run

The local database for this checkout was down (port 57312 closed; no Postgres container). The run
did not start the stack. Run these when the stack is up:

1. `pnpm db:migrate` — applies `20261026083820_add-defense-industry.sql`.
2. `pnpm db:check:datasets` — layer 2 (apply, 261 floors, re-apply over the seeded company, rollback) for all five.
3. `pnpm db:seed:dev -- --email <unused email> --dataset defense` — a real company to browse.
4. Check in the app:
   1. Onboarding lists "Defense & Unmanned Systems" with the shield icon.
   2. The Nordic Defence Materiel Agency's Draft order shows the "ITAR UAS — US ship-to only" violation on its `ISR4-SYS` line.
   3. The `ISR4-AV` part page shows Export jurisdiction ITAR, USML / ECCN "USML VIII(a)(5) — SME", NDAA §848 compliant Yes.
   4. The `ISR4-AV` assembly instruction plays all 38 steps.

## Notes

- Homebrew `opencascade` 7.9.3 was installed for the bake; `cargo build --release -p assembler` took 81 s.
- The assembler takes about 10–18 s to start; `bake.py` now waits up to 2 minutes.
- Two model bugs were found by the bake and fixed in `quad.py`: the battery label groove split each pack into two solids, and the skid caps were empty (the sphere was not moved before the intersect).

## Follow-up run (same day)

The stack came up, so the database checks ran:

| Check | Result |
|---|---|
| `pnpm db:migrate` | schema up to date; `industry` has `defense_uas` (sort 5, icon `shield`) |
| `pnpm db:check:datasets` | satellite, robotics, precision, motor, defense — all pass (apply, 261 floors, re-apply, rollback) |
| `NODE_EXTRA_CA_CERTS=~/.portless/ca.pem pnpm db:seed:dev -- --email defense-demo@example.com --dataset defense` | seeded; MRP and schedule ran. Without the CA variable, user creation fails with "fetch failed" |

The hero swap then ran from that seeded company (renamed to "Halberd Unmanned Systems"
for the capture): step 17 of the ISR-4 assembly (propellers fitted, front view), light and
dark, 1920 × 1254 WebP stills, and 9.4 s 1920 × 1254 H.264 loops of the end of the main build
(step 15 to the end, 1.73× speed). Files replaced: `www/public/screenshots/assembly-{light,dark}.{webp,mp4,jpeg}`
and `.github/assets/readme/assembly-{light,dark}.webp`.

A later pass changed the propeller colour from near-black to gunmetal grey (sRGB 0.38, 0.39,
0.41), so the propellers show against the dark theme. The bake ran again at the same 0.5 / 0.3
deflection. Every node id stayed the same, so `assembly.ts` needed no edit. The pass also
lightened `PRP-2270-CF.svg` to match and captured the hero loops and stills again.
