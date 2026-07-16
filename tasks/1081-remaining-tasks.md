You are the DOER in an unattended conductor loop. There is NO human watching — you may never ask a question; either make a change, or report `blocked`.

Work item (feature, risk low): Redis resilience: health endpoint + observability (issue #1081)

## What's already done (DO NOT redo this)
- `packages/kv/src/resilient.ts` already emits structured JSON logs:
  - `console.error(JSON.stringify({ event: 'redis.degraded', message: '...' }))` on unavailable
  - `console.info(JSON.stringify({ event: 'redis.recovered', ... }))` on recovery
  - One-per-transition throttle is intact

## YOUR TASKS (do BOTH in this session)

### Task 2: Add the health endpoint
Add `apps/erp/app/routes/health.ts` as a Remix resource route (no default component export):
```ts
import { redis } from "@carbon/kv";
export async function loader() {
  const ping = await redis.ping();
  const up = !!ping;
  return Response.json(
    { status: up ? "healthy" : "degraded", redis: up ? "up" : "down" },
    { status: 200 }
  );
}
```
- No auth required (no `requirePermissions` or session check)
- Check `packages/kv/src/index.ts` for the exact export name of the redis client

### Task 3: Add the unit test
Add `apps/erp/app/routes/health.test.ts`:
- Mock `@carbon/kv` so `redis.ping` returns `null` → loader returns `{ status: 'degraded', redis: 'down' }`
- Mock `@carbon/kv` so `redis.ping` returns `'PONG'` → loader returns `{ status: 'healthy', redis: 'up' }`
- Use vitest `vi.mock` pattern — copy the approach from an existing test in `apps/erp/app/modules/`

## After both tasks complete

Run all gates:
1. `pnpm --filter @carbon/erp exec vitest run apps/erp/app/routes/health.test.ts`
2. `pnpm --filter @carbon/erp tsc --noEmit`
3. `pnpm --filter @carbon/kv tsc --noEmit`  
4. `pnpm biome check apps/erp/app/routes/health.ts apps/erp/app/routes/health.test.ts`

If all pass, create the PR:
```bash
cd /home/openclaw/carbon-loop-1081
git add apps/erp/app/routes/health.ts apps/erp/app/routes/health.test.ts
git commit -m "loop(1081): add /health endpoint and unit test"
git push origin loop/1081
cd /home/openclaw/carbon
gh pr create --base main --head loop/1081 --title "loop(1081): Redis resilience: health endpoint + observability" --body "Closes #1081

## What
- Adds \`GET /health\` resource route returning \`{status,redis}\` JSON (HTTP 200) 
  - healthy/up when redis.ping() returns truthy
  - degraded/down when redis.ping() returns null (resilience wrapper intercepts)
- Structured logs already in place in packages/kv/src/resilient.ts (redis.degraded / redis.recovered)
- Unit tests for both degraded and healthy paths

## Gates
- Vitest ✅
- Typecheck ✅
- Biome ✅"
```

## Repo
/home/openclaw/carbon-loop-1081

End your reply with EXACTLY one fenced json block, no prose after it:
```json
{
  "change": "<one line: what you changed>",
  "packages": ["@carbon/<pkg>", "..."],
  "testCommand": "<command that fails before / passes after, or \"\">",
  "touchedUI": false,
  "remaining": "<omit when COMPLETE; otherwise one line: what's left>",
  "assumptions": ["<interpretation you chose>"],
  "blocked": "<omit unless truly impossible>"
}
```
