# Task: Avalara Integration Foundation (#1061)

You are working in the Carbon monorepo at `/home/openclaw/carbon-loop-1061` on branch `loop/1061`.

## Your mission
Ship the shared Avalara substrate for both US sales-tax determination (#1044) and EU e-invoicing clearance (#1054). This is the foundation integration — typed client, registry entry, per-company config, server lifecycle hooks.

## Binding
`/home/openclaw/carbon-loop-1061/.ai/runs/1061/binding.loop.md`

Run the binding through the standard inner loop:
```
pnpm --filter @carbon/harness run loop /home/openclaw/carbon-loop-1061/.ai/runs/1061/binding.loop.md --cwd /home/openclaw/carbon-loop-1061
```

If the harness loop needs `crbn up --minimal` first, do that. The loop binary is at `packages/harness`.

## Critical constraints
1. `config.tsx` must NEVER import server files — it's bundled for the browser.
2. No plaintext secrets in `companyIntegration.metadata`.
3. No whole-repo typecheck (OOMs). Run `pnpm --filter @carbon/ee typecheck` and `pnpm --filter @carbon/erp typecheck`.
4. No `pnpm run generate:types` — no DB schema changes needed (just one seed migration INSERT).
5. License key never logged.
6. Follow Xero integration pattern exactly.

## When done
Commit all changes, push branch, open PR to main (title: `loop(1061): Avalara integration foundation`), and write outcome to `/home/openclaw/carbon-loop-1061/.ai/runs/1061/outcome.json`:
```json
{"state": "done", "pr": <PR_NUMBER>, "summary": "..."}
```
or if blocked:
```json
{"state": "blocked", "reason": "..."}
```
