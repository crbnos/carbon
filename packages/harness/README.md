# @carbon/harness

The deterministic substrate that powers the `build` conductor skill (loop conductor).

## Concepts

- **Bindings** — specs for a loop iteration, parsed from `llm/loops/<id>.loop.md` frontmatter.
- **Ledger** — append-only JSONL log of each iteration's outcome, stored at `llm/loops/<id>/ledger.jsonl`.
- **Floor gates** — cheap, deterministic checks that must pass before any iteration is recorded as `keep`.

## Usage

```ts
import { parseBinding, appendLedger, readLedger, runGates, FLOOR_GATES } from "@carbon/harness";
```

Run the floor gates manually:

```sh
pnpm --filter @carbon/harness gates
```

## Growing the gate list

Add a row to `FLOOR_GATES` in `src/gates.ts`. Each gate is `{ id: string, cmd: string }`. The CLI in `src/scripts/run-gates.ts` shells out via `execSync`; the `runGates` function itself stays pure (injected `Exec`) so it is unit-testable without spawning processes.

## File layout

```
src/
  binding.ts          parse .loop.md frontmatter
  ledger.ts           append-only JSONL ledger
  gates.ts            gate runner (pure) + FLOOR_GATES
  scripts/
    run-gates.ts      CLI entry point
  index.ts            barrel
```
