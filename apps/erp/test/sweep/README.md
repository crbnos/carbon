# Tool sweep

Calls every READ tool for real: this branch's dispatcher and services, as a
signed-in user (row-level security applies), against the data of a seeded
company on a running local stack. The unit tests stand services in; this is
where a tool is actually run.

```bash
pnpm sweep:tools
```

It needs a stack that is up (`crbn up`), migrated (`pnpm db:migrate`) and seeded
(`pnpm db:seed:dev -- --email <you> --dataset satellite`, which also runs the
planner). A thin company still sweeps, but more tools are asked for a row that
does not exist. It is not part of `pnpm test`.

## What it does

1. Refuses to run when the stack has not applied a migration this branch has —
   a tool that calls a function the database lacks fails for a reason that is
   not the tool's. `CARBON_SWEEP_ALLOW_DRIFT=1` sweeps anyway.
2. Works out each tool's arguments (`inputs.ts`). A parameter the service
   compares to a column (`.eq("id", jobId)` on `job`, read off the body by
   `paramFilters`) gets a value that exists, sampled as the user. Failing that,
   the column a parameter of that NAME is compared to across every service,
   then the database's own table or column of that name. Several real values
   are tried before "no row matches" stands: the first item may not be a tool.
   When the company has no row at all, the tool is called with a value of the
   column's type that matches nothing, and the report lists the argument under
   `placeholder`. What nothing can answer is written down per tool in
   `read-tools.inputs.ts`; a required argument still unanswered leaves the tool
   not called.
3. Calls the tool and records one of: `ok`, `failed`, `not-found` (it ran and
   no row matched what it was given), `not-called` (with the reason). A tool
   that was not called fails the sweep: it was not checked. Give its argument a
   value in `read-tools.inputs.ts`.
4. Writes `.report/read-tools.json` and compares the failures with
   `read-tools.baseline.json`.

## The baseline

`read-tools.baseline.json` lists the tools known to fail, with the error. It is
empty: a tool that fails is fixed, not listed. A failure under
`CARBON_SWEEP_ALLOW_DRIFT=1` that names a function or column the stack lacks is
the drift, not the tool. The
sweep fails on a tool that fails and is not listed, and on a listed tool that
now passes — so the list only shrinks. After fixing one, delete its entry.
`CARBON_SWEEP_UPDATE=1` rewrites the file from the current run; read the diff
before committing it.

## Choosing the company

`SWEEP_COMPANY_ID` and `SWEEP_USER_ID`, or by default the `DEV_BYPASS_EMAIL`
user in whichever of its companies has the most items. `CARBON_SWEEP_ENV` points
the sweep at another checkout's stack (`<checkout>/.env:<checkout>/.env.local`).

Only READ tools are called. The generator refuses to publish a read that writes,
in TypeScript or through a SQL function, so the sweep cannot change data.
