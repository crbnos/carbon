---
paths:
  - "apps/erp/app/modules/**"
  - "apps/erp/app/routes/**"
  - "packages/api/src/**"
  - "packages/checks/src/conformance/module-shape.ts"
  - "packages/checks/src/conformance/service-fn-file.ts"
  - "packages/checks/src/conformance/no-server-code-in-client.ts"
---

# Module files: service functions, building blocks, no barrels

Every ERP operation is one `defineServiceFn` const. Routes, the HTTP API, MCP
and workflows call that same const, so one permission gate and one body serve
every caller. A module's files say which code is which.

## The files of a module

| File | Holds | Runs |
|---|---|---|
| `<module>.server.ts` | `defineServiceFn` consts only: the module's API | server |
| `<module>.service.ts` | every building block: queries, writes, helpers, Kysely transactions | server |
| `<module>.models.ts` | zod validators and the types derived from them | both |
| `<module>.utils.ts` | the pure or browser-safe helpers a component calls | both |
| `types.ts` | the module's shared types | both |
| `*.pdf.tsx` | a document renderer (JSX, so it cannot sit in a `.ts` file) | server |
| `ui/` | components | browser |

There is no `index.ts` and no `index.server.ts`. Import a thing from the file
that defines it: `~/modules/sales/sales.models`, never `~/modules/sales`.

## `<module>.server.ts`: the module's API

- Each export is `export const <name> = defineServiceFn({ input, permission, run })`.
  Types and plain constants (a `logger`, a lookup `Set`) may sit beside them.
  A helper function, a class, or an exported value goes in `.service.ts`.
- The const's name IS the public name. `apps/erp/app/modules/router.server.ts`
  imports each server file as a namespace (`import * as sales from
  "./sales/sales.server"`), so `setQuoteStatus` in `sales.server.ts` is:
  - `api.sales.setQuoteStatus(input)` in a route,
  - the MCP tool `sales_setQuoteStatus`,
  - `POST /api/v1/sales/setQuoteStatus`.
  Name it `<verb><Entity>` (`getCustomers`, `createJob`, `deleteJobOperation`).
  Renaming it renames the public tool: list it in the changelog.
- A const is published (MCP, HTTP, docs) only when its TSDoc has `@mcp`
  (`@mcp read`, `@mcp destructive`). The summary line is the title, `@remarks`
  the description, `@param name - text` a field's description, `@returns` the
  response. See `conventions-services.md`.
- Call building blocks through a namespace import, so a service function and
  the building block it wraps can share a name:
  ```ts
  import * as service from "./sales.service";
  export const getCustomers = defineServiceFn({
    input: z.object({ search: z.string().optional() }),
    permission: { view: "sales" },
    async run(ctx, input) {
      return paged(ctx, await service.getCustomers(ctx.asCaller.supabase, ctx.company.id, input));
    }
  });
  ```

## `<module>.service.ts`: the building blocks

Server-only. It may import `.server` packages (`@carbon/auth/client.server`,
`@carbon/ee/*.server`) and other modules' service files. Nothing in the browser
imports it (the `no-server-code-in-client` check), so it carries no bundle cost.
A function a component calls lives in `<module>.utils.ts` instead.

## A posting ported from the deleted `@carbon/server-functions`

The package was dissolved into the modules (plan Phase 5) and deleted. A ported
function kept its logic as is:

- Its body becomes a building block in `<module>.service.ts`:
  `export async function <name>(ctx: ServiceContext, raw)`, whose first line
  parses the function's own input schema (exported beside it). `ctx.db` is
  `ctx.asSystem.pg`, `ctx.companyId` is `ctx.company.id`, `ctx.userId` is
  `ctx.auditUserId`.
- The operation that runs it calls `run(ctx, "<posting-name>", () =>
  service.<name>(ctx, input))` (`@carbon/api/service-tools.server`). A body
  throws with messages written for the person (673 plain `Error`s); `run`
  turns a throw into a refusal by the rules the package's `defineServerFn` used, so the message and
  status a caller sees do not change. Without it, a throw is `internal` and its message is withheld.
- A caller that read the `{ data, error }` the package's `invoke` returned (a fallback
  message, the error's `status` or `body`) calls `invokePosting(ctx, "<name>",
  input, service.<name>)` (`~/modules/shared/shared.service`) instead: the same
  shape and the same `ServerFnError`. An older building block that holds `db`,
  `companyId` and `userId` passes those in place of `ctx`; with `{ as: rule }`
  it checks the caller behind `client` first.
- The operation keeps the function's permission exactly: a `<name>Permission`
  constant beside the body, passed as `as`. `apps/erp/test/posting-permissions.test.ts`
  pins them.
- Its live-database tests move to `apps/erp/test/database/`, on the fixtures in
  `apps/erp/test/database/fixtures/` (`always-post.ts`, whose `service` is a
  system `ServiceContext`).

## Shared code: `@carbon/api`

| Import | From |
|---|---|
| `defineServiceFn`, `CarbonError`, `ServiceContext`, `toResult` | `@carbon/api/service-fn.server` |
| `payload`, `unwrap`, `paged`, `run`, `attempt` | `@carbon/api/service-tools.server` |
| `carbon`, `carbonFor`, `dataOrThrow`, `respond` | `@carbon/api/carbon.server` |

The ERP hands `carbon()` its router and caller context once
(`registerCarbon`, in `apps/erp/app/modules/carbon.server.ts`, imported by
`entry.server.tsx`) and its router type through `Register`.

## A route loader

A loader reads through the service functions too, so it passes the same gate
an API or MCP caller does. Bind `api` to the loader's own caller: `carbon(request)`
would authenticate a second time, and for a `bypassRls: true` route it would
replace the service-role client with the user's.

```ts
export async function loader({ request, params }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, { view: "sales" });
  const api = carbonFor(auth);
  const [customer, locations] = await Promise.all([
    api.sales.getCustomer({ customerId: params.customerId! }),
    api.resources.getLocationsList({})
  ]);
  if (customer.error) throw redirect(path.to.customers, await flash(request, error(customer.error, "Failed to load customer")));
  return { customer: customer.data, locations: locations.data ?? [] };
}
```

- A paged read answers `data: { rows, count }`. A list loader that hands the
  raw page to its component returns `{ data: page.data?.rows ?? null, count:
  page.data?.count ?? null, error: page.error }`.
- A refusal is `{ category, message, status }`: a missing row is `category ===
  "notFound"`, never a `PGRST116` code.
- A service function that returns a plain value (not `unwrap`/`paged`) is read
  with `dataOrThrow(await api.<module>.<fn>(input))`
  (`@carbon/api/carbon.server`): the value, or the refusal thrown.
- A lookup every screen needs (locations, units) gates on `"employee"`, so a
  page reads it without the module's permission. Only a lookup whose tables
  RLS lets every employee read may do so; one that reads a restricted table
  keeps its module's `view`, and a loader without that permission calls the
  building block directly (baselined in `loader-reads-through-api`).
- A building block no service function calls is a helper (a time zone, user
  defaults, a label logo) and the loader calls it directly. A read made as the
  service role, or for another company of the group, stays a direct call too.

## A route action

```ts
export async function action(args: ActionFunctionArgs) {
  const input = await validator(jobValidator).request(args, { params: ["jobId"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.production.cancelJob({ jobId: input.params.jobId });
  return result; // a fetcher form: the component's useAction toasts it
  // a navigating form instead:
  // return respond(args.request, result).redirect(path.to.job(id), { message: "Job cancelled", onError: path.to.jobDetails(id) });
}
```

`respond(request, result).redirect(to, { message, onError })` flashes the
result's error, or `message`, and redirects; `onError` sends a refused call
elsewhere.

## Checks

| Check | Fails |
|---|---|
| `module-shape` | an `index.ts` / `index.server.ts`, or a `.server` file other than `<module>.server.ts` |
| `service-fn-file` | anything in `<module>.server.ts` other than imports, types, plain constants and exported `defineServiceFn` consts |
| `no-server-code-in-client` | a value import of a `.service` or `.server` file from components, hooks, `ui/`, models, utils or types |
| `route-action-shape` | a write made in a route instead of a service function |
| `loader-reads-through-api` | a loader calling a building block that a service function wraps (`service.<name>(…)` in `<module>.server.ts`) |
