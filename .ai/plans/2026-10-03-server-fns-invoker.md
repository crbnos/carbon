# Typed `serverFns` invoker

One front door for server functions, replacing `fn.withClient(client, db, input)` and
hand-written `await import("@carbon/server-functions/<name>")`.

```ts
import { serverFns } from "@carbon/server-functions";

await serverFns.system({ db, companyId, userId }).invoke("post-receipt", { receiptId });
await serverFns.as({ client, db, companyId, userId }).invoke("post-picking", input);
await serverFns.system(fields).invokeOrThrow("post-charge", input); // throws ServerFnError
```

Decisions (agreed in chat, 2026-10-03):

- Name is the function's own kebab-case `name` (its directory).
- Lazy registry: one literal `() => import("./<dir>")` per function; each function is its
  file's DEFAULT export.
- `system(...)` is the explicit elevation; `as(...)` derives the actor from the caller's
  client exactly as `withClient` did (`ServerFnContext.fromClient`), so behaviour is unchanged.
- Result stays `{ data, error }`; a failed module load or context build is an error result.
- `invoke.ts` imports types only at module scope, so browser-bundled `*.service.ts` files
  can import it statically.
- `db` stays an explicit field: the package cannot import an app's database client.

Steps

- [x] `src/invoke.ts` + registry test (every directory registered, key === `serverFnName`)
- [x] default-export every function; fix package-internal imports and tests
- [x] codemod call sites in apps/erp, apps/mes, packages/jobs, packages/ee
- [x] remove `withClient` from `defineServerFn` / `ServerFn`
- [x] AGENTS.md + rules that describe calling a server function
- [x] typecheck (server-functions, jobs, ee, erp, mes), tests, parity replay
