# Period Closing — Implementation Plan

> ⚠️ **2026-07-03 delta (readiness roadmap):** the spec gained a posted-record immutability fold-in (`2026-07-03-public-company-readiness.md` MW-1 → spec §Enforcement item 4): extend the drafted migration `20260702044133` with (a) a second SECURITY DEFINER trigger — Posted journals allow only `Posted → Reversed`; journalLines frozen once parent is Posted, all period states — and (b) `journalLine.createdBy`. Add matching acceptance tests. See `.ai/plans/2026-07-03-public-company-readiness-roadmap.md`.
>
> ⚠️ **2026-07-04 delta (user direction):** the spec now includes a **NetSuite-style persisted close checklist** (spec §NetSuite-style close checklist), superseding "computed, not persisted". Execute the **Addendum Tasks 17–20** at the end of this plan; Task 13's close drawer becomes the checklist UI (Task 19 amends it); "persisted close-checklist tasks" is removed from the Deferred list.

## Overview

- **Design Spec:** `.ai/specs/2026-07-02-period-closing.md` (status: in-progress, all open questions resolved)
- **Research:** `.ai/research/period-closing.md`
- **Tasks:** 16 tasks (~60–75 min of work) + gated verification
- **Branch:** `feature/period-closing`

**Ground rules for the executor:**

- Do NOT regenerate or commit `packages/database/src/types.ts` — committed types are cloud-generated. Access new columns (`closeStatus`, `fiscalYear`, `periodNumber`, `lockedAt`, `lockedBy`) via `(client.from("accountingPeriod") as any)` / `as unknown as` casts (established pattern, e.g. `(client as any).from("itemSamplingPlan")` in post-receipt).
- Do NOT rebuild the database. Apply the migration with `pnpm db:migrate` only, when the local stack is up.
- Typecheck per package (`pnpm --filter @carbon/erp typecheck`), never whole-repo `tsc --noEmit`.
- Commit only at the marked checkpoints, after verification passes (check-and-commit gate).

## Dependencies

```
Task 1 (migration, already drafted)
  └─ Task 15 (apply migration) — deferred until stack is up
Task 2 (models) ─┬─ Task 3 (getOrCreateAccountingPeriod) ─┬─ Task 5 (postJournalEntry/reverse gates)
                 │                                         └─ Task 6 (depreciation/disposal routes)
                 ├─ Task 4 (period services)  ─── Task 11–13 (routes/UI)
Task 7 (edge helper) — independent
Task 8 (audit config) — independent
Task 9 (status colors) / Task 10 (path.ts) — independent, needed by 11–13
Task 14 (sidebar) — after Task 10
Task 16 (typecheck/lint) — last code task
```

---

## Task 1: Migration (ALREADY DRAFTED — review only)

**Files:**
- Exists: `packages/database/supabase/migrations/20260702044133_period-close-lifecycle.sql`

Already written this session. Contents: `periodCloseStatus` enum (`Open`/`Locked`/`Closed`); `closeStatus`, `fiscalYear`, `periodNumber`, `lockedAt`, `lockedBy` columns on `accountingPeriod`; backfill of `closeStatus` from `closedAt` and of `fiscalYear`/`periodNumber` from `startDate` + `fiscalYearSettings.startMonth` (FY named by ending calendar year); unique index `(companyId, fiscalYear, periodNumber)` with non-unique fallback; `check_accounting_period_open()` BEFORE trigger on `journal` (blocks INSERT into Closed, re-dating into/out of Closed, Draft→Posted in Closed, DELETE of non-Draft in Closed; allows Posted→Reversed).

**Steps:**
1. Re-read the file and confirm it matches the spec's Data Model section.
2. Confirmed already: no views select from `accountingPeriod`, so no view recreation needed.
3. Do NOT apply yet — application is Task 15.

---

## Task 2: Models — `periodCloseStatuses` + validators

**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts`
- Modify: `apps/erp/app/modules/accounting/types.ts`

**Steps:**

1. In `accounting.models.ts`, next to `journalEntryStatuses` (line ~482), add:

```typescript
export const periodCloseStatuses = ["Open", "Locked", "Closed"] as const;

export const accountingPeriodTransitionValidator = z.object({
  intent: z.enum(["lock", "unlock", "close", "reopen"]),
  periodId: z.string().min(1, { message: "Period is required" })
});

export const generateFiscalYearPeriodsValidator = z.object({
  intent: z.literal("generate"),
  fiscalYear: zfd.numeric(
    z.number().int().min(2000).max(2200)
  )
});
```

2. In `types.ts`, add (after Task 4's service functions exist):

```typescript
export type AccountingPeriodListItem = NonNullable<
  Awaited<ReturnType<typeof getAccountingPeriods>>["data"]
>[number];
export type PeriodCloseStatus = (typeof periodCloseStatuses)[number];
export type PeriodCloseReadiness = NonNullable<
  Awaited<ReturnType<typeof getPeriodCloseReadiness>>["data"]
>;
```
(Match the file's existing import style for the service/model imports.)

3. Verify barrel: `apps/erp/app/modules/accounting/index.ts` re-exports `*` from models/service/types (it does — no change unless exports are enumerated).

---

## Task 3: Service — extend `getOrCreateAccountingPeriod` with posting source

**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` (lines 509–574)

**Steps:**

1. Replace the function with:

```typescript
type PeriodPostingSource = "operational" | "accounting";

type AccountingPeriodCloseColumns = {
  closeStatus?: "Open" | "Locked" | "Closed";
  fiscalYear?: number | null;
  periodNumber?: number | null;
};

const MONTH_NUMBER: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12
};

function fiscalYearAndPeriodFor(
  date: Date,
  startMonth: number
): { fiscalYear: number; periodNumber: number } {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const periodNumber = ((month - startMonth + 12) % 12) + 1;
  const fiscalYear =
    startMonth === 1 ? year : month >= startMonth ? year + 1 : year;
  return { fiscalYear, periodNumber };
}

export async function getOrCreateAccountingPeriod(
  client: SupabaseClient<Database>,
  companyId: string,
  date: string,
  source: PeriodPostingSource = "operational"
): Promise<{ data: string | null; error: { message: string } | null }> {
  const existing = await getCurrentAccountingPeriod(client, companyId, date);

  if (existing.data) {
    const closeStatus =
      (existing.data as unknown as AccountingPeriodCloseColumns).closeStatus ??
      "Open";

    if (closeStatus === "Closed") {
      return {
        data: null,
        error: {
          message: "Accounting period is closed. Reopen it before posting."
        }
      };
    }

    if (closeStatus === "Locked" && source === "operational") {
      return {
        data: null,
        error: {
          message:
            "Accounting period is locked. Post as an accounting adjustment or unlock the period first."
        }
      };
    }

    if (existing.data.status === "Inactive") {
      await client
        .from("accountingPeriod")
        .update({ status: "Inactive" as const })
        .eq("companyId", companyId)
        .eq("status", "Active");

      await client
        .from("accountingPeriod")
        .update({ status: "Active" as const })
        .eq("id", existing.data.id);
    }
    return { data: existing.data.id, error: null };
  }

  // Create a new period for the month of the given date
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-indexed
  const startDate = new Date(year, month, 1).toISOString().split("T")[0];
  const endDate = new Date(year, month + 1, 0).toISOString().split("T")[0];

  const settings = await getFiscalYearSettings(client, companyId);
  const startMonth = settings.data?.startMonth
    ? MONTH_NUMBER[settings.data.startMonth] ?? 1
    : 1;
  const { fiscalYear, periodNumber } = fiscalYearAndPeriodFor(d, startMonth);

  await client
    .from("accountingPeriod")
    .update({ status: "Inactive" as const })
    .eq("companyId", companyId)
    .eq("status", "Active");

  const result = await (client.from("accountingPeriod") as any)
    .insert({
      startDate,
      endDate,
      companyId,
      status: "Active" as const,
      closeStatus: "Open",
      fiscalYear,
      periodNumber,
      createdBy: "system"
    })
    .select("id")
    .single();

  if (result.error) {
    return {
      data: null,
      error: { message: "Failed to create accounting period" }
    };
  }

  return { data: result.data.id, error: null };
}
```

Notes: the legacy Active/Inactive toggle is intentionally untouched (spec decision). `getFiscalYearSettings` already exists in this file — keep its existing definition.

---

## Task 4: Service — period queries, transitions, generation, readiness

**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` (add below `getOrCreateAccountingPeriod`)

**Steps:**

1. Add:

```typescript
export async function getAccountingPeriods(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return (client.from("accountingPeriod") as any)
    .select(
      "id, startDate, endDate, status, closeStatus, fiscalYear, periodNumber, lockedAt, lockedBy, closedAt, closedBy",
      { count: "exact" }
    )
    .eq("companyId", companyId)
    .order("startDate", { ascending: false }) as Promise<{
    data:
      | {
          id: string;
          startDate: string;
          endDate: string;
          status: "Active" | "Inactive";
          closeStatus: "Open" | "Locked" | "Closed";
          fiscalYear: number | null;
          periodNumber: number | null;
          lockedAt: string | null;
          lockedBy: string | null;
          closedAt: string | null;
          closedBy: string | null;
        }[]
      | null;
    count: number | null;
    error: { message: string } | null;
  }>;
}

async function getAccountingPeriodById(
  client: SupabaseClient<Database>,
  periodId: string,
  companyId: string
) {
  const result = await (client.from("accountingPeriod") as any)
    .select("id, startDate, endDate, closeStatus, fiscalYear, periodNumber")
    .eq("id", periodId)
    .eq("companyId", companyId)
    .single();
  return result as {
    data: {
      id: string;
      startDate: string;
      endDate: string;
      closeStatus: "Open" | "Locked" | "Closed";
      fiscalYear: number | null;
      periodNumber: number | null;
    } | null;
    error: { message: string } | null;
  };
}

export async function lockAccountingPeriod(
  client: SupabaseClient<Database>,
  args: { periodId: string; companyId: string; userId: string }
) {
  const period = await getAccountingPeriodById(
    client,
    args.periodId,
    args.companyId
  );
  if (period.error || !period.data) {
    return { data: null, error: period.error ?? { message: "Period not found" } };
  }
  if (period.data.closeStatus !== "Open") {
    return {
      data: null,
      error: { message: "Only open periods can be locked" }
    };
  }
  return (client.from("accountingPeriod") as any)
    .update({
      closeStatus: "Locked",
      lockedAt: new Date().toISOString(),
      lockedBy: args.userId,
      updatedBy: args.userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", args.periodId)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

export async function unlockAccountingPeriod(
  client: SupabaseClient<Database>,
  args: { periodId: string; companyId: string; userId: string }
) {
  const period = await getAccountingPeriodById(
    client,
    args.periodId,
    args.companyId
  );
  if (period.error || !period.data) {
    return { data: null, error: period.error ?? { message: "Period not found" } };
  }
  if (period.data.closeStatus !== "Locked") {
    return {
      data: null,
      error: { message: "Only locked periods can be unlocked" }
    };
  }
  return (client.from("accountingPeriod") as any)
    .update({
      closeStatus: "Open",
      lockedAt: null,
      lockedBy: null,
      updatedBy: args.userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", args.periodId)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

export async function closeAccountingPeriod(
  client: SupabaseClient<Database>,
  args: { periodId: string; companyId: string; userId: string }
) {
  const period = await getAccountingPeriodById(
    client,
    args.periodId,
    args.companyId
  );
  if (period.error || !period.data) {
    return { data: null, error: period.error ?? { message: "Period not found" } };
  }
  if (period.data.closeStatus === "Closed") {
    return { data: null, error: { message: "Period is already closed" } };
  }

  // Sequential close: every earlier period must already be Closed
  const earlierOpen = await (client.from("accountingPeriod") as any)
    .select("id", { count: "exact", head: true })
    .eq("companyId", args.companyId)
    .lt("startDate", period.data.startDate)
    .neq("closeStatus", "Closed");
  if ((earlierOpen.count ?? 0) > 0) {
    return {
      data: null,
      error: {
        message: "Earlier periods must be closed first (sequential close)"
      }
    };
  }

  return (client.from("accountingPeriod") as any)
    .update({
      closeStatus: "Closed",
      closedAt: new Date().toISOString(),
      closedBy: args.userId,
      updatedBy: args.userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", args.periodId)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

export async function reopenAccountingPeriod(
  client: SupabaseClient<Database>,
  args: { periodId: string; companyId: string; userId: string }
) {
  const period = await getAccountingPeriodById(
    client,
    args.periodId,
    args.companyId
  );
  if (period.error || !period.data) {
    return { data: null, error: period.error ?? { message: "Period not found" } };
  }
  if (period.data.closeStatus !== "Closed") {
    return { data: null, error: { message: "Period is not closed" } };
  }

  // Reverse-sequential reopen: no later period may still be Closed
  const laterClosed = await (client.from("accountingPeriod") as any)
    .select("id", { count: "exact", head: true })
    .eq("companyId", args.companyId)
    .gt("startDate", period.data.startDate)
    .eq("closeStatus", "Closed");
  if ((laterClosed.count ?? 0) > 0) {
    return {
      data: null,
      error: {
        message: "Later periods must be reopened first (reopen from the most recent close backwards)"
      }
    };
  }

  return (client.from("accountingPeriod") as any)
    .update({
      closeStatus: "Open",
      closedAt: null,
      closedBy: null,
      updatedBy: args.userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", args.periodId)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

export async function createFiscalYearPeriods(
  client: SupabaseClient<Database>,
  args: { companyId: string; fiscalYear: number; userId: string }
) {
  const settings = await getFiscalYearSettings(client, args.companyId);
  const startMonth = settings.data?.startMonth
    ? MONTH_NUMBER[settings.data.startMonth] ?? 1
    : 1;

  // FY is named by its ending calendar year
  const firstYear = startMonth === 1 ? args.fiscalYear : args.fiscalYear - 1;

  const existing = await (client.from("accountingPeriod") as any)
    .select("periodNumber")
    .eq("companyId", args.companyId)
    .eq("fiscalYear", args.fiscalYear);
  if (existing.error) return existing;
  const existingNumbers = new Set(
    ((existing.data ?? []) as { periodNumber: number | null }[]).map(
      (p) => p.periodNumber
    )
  );

  const rows = [];
  for (let p = 1; p <= 12; p++) {
    if (existingNumbers.has(p)) continue;
    const monthIndex = (startMonth - 1 + (p - 1)) % 12; // 0-indexed
    const year = firstYear + Math.floor((startMonth - 1 + (p - 1)) / 12);
    const startDate = new Date(Date.UTC(year, monthIndex, 1));
    const endDate = new Date(Date.UTC(year, monthIndex + 1, 0));
    rows.push({
      companyId: args.companyId,
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
      status: "Inactive",
      closeStatus: "Open",
      fiscalYear: args.fiscalYear,
      periodNumber: p,
      createdBy: args.userId
    });
  }

  if (rows.length === 0) {
    return { data: [], error: null };
  }

  return (client.from("accountingPeriod") as any).insert(rows).select("id");
}

export async function getPeriodCloseReadiness(
  client: SupabaseClient<Database>,
  companyId: string,
  periodId: string
) {
  const period = await getAccountingPeriodById(client, periodId, companyId);
  if (period.error || !period.data) {
    return { data: null, error: period.error ?? { message: "Period not found" } };
  }
  const { startDate, endDate } = period.data;

  const [draftJournals, journalsInPeriod, draftDepreciation, unmatchedIC] =
    await Promise.all([
      client
        .from("journal")
        .select("id", { count: "exact", head: true })
        .eq("companyId", companyId)
        .eq("status", "Draft")
        .gte("postingDate", startDate)
        .lte("postingDate", endDate),
      client
        .from("journalEntries")
        .select("id, journalEntryId, totalDebits, totalCredits")
        .eq("companyId", companyId)
        .eq("status", "Posted")
        .gte("postingDate", startDate)
        .lte("postingDate", endDate),
      client
        .from("depreciationRun")
        .select("id", { count: "exact", head: true })
        .eq("companyId", companyId)
        .eq("status", "Draft")
        .gte("periodEnd", startDate)
        .lte("periodEnd", endDate),
      client
        .from("intercompanyTransaction")
        .select("id", { count: "exact", head: true })
        .eq("status", "Unmatched")
        .or(`sourceCompanyId.eq.${companyId},targetCompanyId.eq.${companyId}`)
    ]);

  const unbalanced = (journalsInPeriod.data ?? []).filter(
    (j) =>
      Math.abs(Number(j.totalDebits ?? 0) - Number(j.totalCredits ?? 0)) > 0.001
  );

  const blockers: { key: string; label: string; count: number }[] = [];
  const warnings: { key: string; label: string; count: number }[] = [];

  if ((draftJournals.count ?? 0) > 0) {
    blockers.push({
      key: "draftJournals",
      label: "Draft journal entries dated in this period",
      count: draftJournals.count ?? 0
    });
  }
  if (unbalanced.length > 0) {
    blockers.push({
      key: "unbalancedJournals",
      label: "Posted journal entries with unequal debits and credits",
      count: unbalanced.length
    });
  }
  if ((draftDepreciation.count ?? 0) > 0) {
    warnings.push({
      key: "draftDepreciation",
      label: "Draft depreciation runs ending in this period",
      count: draftDepreciation.count ?? 0
    });
  }
  if ((unmatchedIC.count ?? 0) > 0) {
    warnings.push({
      key: "unmatchedIntercompany",
      label: "Unmatched intercompany transactions involving this company",
      count: unmatchedIC.count ?? 0
    });
  }

  return { data: { blockers, warnings }, error: null };
}
```

2. Verify column names before finalizing: `depreciationRun.periodEnd` and `intercompanyTransaction.sourceCompanyId/targetCompanyId/status` (grep the migrations if types complain). Negative-inventory and pending-posting-queue checks are explicitly deferred (spec changelog).

---

## Task 5: Gate `postJournalEntry` (+ stamp period) and `reverseJournalEntry`

**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` (lines ~1896–2048)

**Steps:**

1. In `postJournalEntry`, after the balance validation (`if (Math.abs(totalDebit - totalCredit) > 0.001) {...}`) and before the status-flip update, insert:

```typescript
  // 3. Period gate — manual JEs are accounting-source postings
  const period = await getOrCreateAccountingPeriod(
    client,
    entry.data.companyId,
    entry.data.postingDate,
    "accounting"
  );
  if (period.error) {
    return { data: null, error: period.error };
  }
```

and change the update payload to stamp the period:

```typescript
  return client
    .from("journal")
    .update({
      status: "Posted" as const,
      accountingPeriodId: period.data,
      postedAt: new Date().toISOString(),
      postedBy: userId,
      updatedBy: userId
    })
    .eq("id", id)
    .select("id")
    .single();
```

(Renumber the step comments: the status flip becomes step 4.)

2. In `reverseJournalEntry`, before the reversing-entry insert, add:

```typescript
  const reversalDate = new Date().toISOString().split("T")[0];
  const period = await getOrCreateAccountingPeriod(
    client,
    data.companyId,
    reversalDate,
    "accounting"
  );
  if (period.error) {
    return { data: null, error: period.error };
  }
```

and in the insert payload use `postingDate: reversalDate,` and add `accountingPeriodId: period.data,`.

---

## Task 6: Pass `source: "accounting"` in depreciation/disposal routes

**Files:**
- Modify: `apps/erp/app/routes/x+/depreciation-run+/$depreciationRunId.post.tsx`
- Modify: `apps/erp/app/routes/x+/fixed-asset+/$fixedAssetId.dispose.tsx`

**Steps:**

1. In each route, find the existing `getOrCreateAccountingPeriod(client, companyId, <date>)` call and append the fourth argument `"accounting"`.
2. No other changes — both routes already handle the `{ error }` return with a flash redirect.

---

## Task 7: Edge-function shared helper — enforce close status

**Files:**
- Modify: `packages/database/supabase/functions/shared/get-accounting-period.ts`

This is the copy used by post-receipt (l.402), post-shipment (l.763), post-purchase-invoice (l.1382), post-payment (l.294). All are **operational** sources; they post as of *today*. It currently checks nothing about closure.

**Steps:**

1. In `getCurrentAccountingPeriod`, immediately after the `currentAccountingPeriod` fetch and before the `status === "Active"` branch, add:

```typescript
  const closeStatus =
    (currentAccountingPeriod.data as unknown as {
      closeStatus?: "Open" | "Locked" | "Closed";
    } | null)?.closeStatus ?? "Open";

  if (closeStatus === "Closed") {
    throw new Error(
      "Accounting period is closed. Reopen it before posting."
    );
  }
  if (closeStatus === "Locked") {
    throw new Error(
      "Accounting period is locked. Unlock it before posting operational transactions."
    );
  }
```

2. In the same file, the lazy-creation branch (`insertInto("accountingPeriod")`) should stamp `closeStatus: "Open"` — add it to the `.values({...})` (cast the values object `as any` if the Kysely `DB` type lacks the column).

3. Confirm each of the four edge functions wraps its handler in try/catch that returns a 4xx/5xx with the error message (they do — posting failures surface to the Inngest job, which retries 3× then fails loudly on the document; spec decision).

---

## Task 8: Audit config — register `accountingPeriod` entity

**Files:**
- Modify: `packages/database/src/audit.config.ts`

**Steps:**

1. Add to `auditConfig.entities` (alphabetical placement near the top-level entities):

```typescript
  accountingPeriod: {
    label: "Accounting Period",
    tables: {
      accountingPeriod: { role: "root" }
    }
  },
```

2. If the config supports `createFields`, surface `["startDate", "endDate", "closeStatus", "fiscalYear", "periodNumber"]` on the root table in the same style as an existing example. Note `skipFields` already excludes `updatedAt`/`updatedBy`, so lock/close/reopen UPDATE diffs will show `closeStatus`, `lockedAt/By`, `closedAt/By` — exactly the audit trail the spec requires.
3. Note: audit subscriptions sync when audit logging is (re)enabled in settings (`syncAuditSubscriptions`); no migration needed.

---

## Task 9: Status color map

**Files:**
- Modify: `packages/utils/src/status-colors.ts`

**Steps:**

1. Check the `StatusColor` union in the same file for the exact allowed values; then next to `JOURNAL_ENTRY_STATUS_COLOR_MAP` (line ~171) add, using the closest available colors to gray/orange/green:

```typescript
export const PERIOD_CLOSE_STATUS_COLOR_MAP = {
  Open: "gray",
  Locked: "orange",
  Closed: "green"
} as const satisfies Record<string, StatusColor>;
```

(If `orange` is not in `StatusColor`, use `yellow`.)

---

## Task 10: Path helpers

**Files:**
- Modify: `apps/erp/app/utils/path.ts`

**Steps:**

1. Near the other accounting entries (`accountingJournals`, etc., ~line 467–515), add:

```typescript
    accountingPeriods: `${x}/accounting/periods`,
    accountingPeriodClose: (id: string) =>
      generatePath(`${x}/accounting/periods/${id}/close`),
```

---

## Task 11: UI — `PeriodCloseStatus` badge + `AccountingPeriodsTable`

**Files:**
- Create: `apps/erp/app/modules/accounting/ui/Periods/PeriodCloseStatus.tsx`
- Create: `apps/erp/app/modules/accounting/ui/Periods/AccountingPeriodsTable.tsx`
- Create: `apps/erp/app/modules/accounting/ui/Periods/index.ts`

**Steps:**

1. `PeriodCloseStatus.tsx` (mirrors `JournalEntryStatus.tsx`):

```typescript
import { Status } from "@carbon/react";
import { PERIOD_CLOSE_STATUS_COLOR_MAP } from "@carbon/utils";
import type { periodCloseStatuses } from "../../accounting.models";

type PeriodCloseStatusProps = {
  status?: (typeof periodCloseStatuses)[number] | null;
};

const PeriodCloseStatus = ({ status }: PeriodCloseStatusProps) => {
  if (!status) return null;
  const color = PERIOD_CLOSE_STATUS_COLOR_MAP[status];
  if (!color) return null;

  return <Status color={color}>{status}</Status>;
};

export default PeriodCloseStatus;
```

2. `AccountingPeriodsTable.tsx` (pattern: `DepreciationRunTable.tsx`; row actions submit intents to the parent route action via `useFetcher`, Close navigates to the close drawer, Reopen uses a confirm modal):

```typescript
import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuCalendar,
  LuCalendarCheck,
  LuHash,
  LuLock,
  LuLockOpen,
  LuRotateCcw,
  LuStar
} from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { Table } from "~/components";
import { Confirm } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { AccountingPeriodListItem } from "../../types";
import PeriodCloseStatus from "./PeriodCloseStatus";

type AccountingPeriodsTableProps = {
  data: AccountingPeriodListItem[];
  count: number;
  primaryAction?: ReactNode;
};

function periodLabel(row: AccountingPeriodListItem) {
  if (row.fiscalYear && row.periodNumber) {
    return `FY${row.fiscalYear} · P${row.periodNumber}`;
  }
  return formatDate(row.startDate);
}

const AccountingPeriodsTable = memo(
  ({ data, count, primaryAction }: AccountingPeriodsTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();
    const fetcher = useFetcher();
    const [selectedPeriod, setSelectedPeriod] =
      useState<AccountingPeriodListItem | null>(null);
    const reopenModal = useDisclosure();

    const submitIntent = useCallback(
      (intent: "lock" | "unlock" | "reopen", periodId: string) => {
        fetcher.submit(
          { intent, periodId },
          { method: "post", action: path.to.accountingPeriods }
        );
      },
      [fetcher]
    );

    const columns = useMemo<ColumnDef<AccountingPeriodListItem>[]>(
      () => [
        {
          accessorKey: "periodNumber",
          header: "Period",
          cell: ({ row }) => periodLabel(row.original),
          meta: { icon: <LuHash /> }
        },
        {
          accessorKey: "startDate",
          header: "Start",
          cell: ({ row }) => formatDate(row.original.startDate),
          meta: { icon: <LuCalendar /> }
        },
        {
          accessorKey: "endDate",
          header: "End",
          cell: ({ row }) => formatDate(row.original.endDate),
          meta: { icon: <LuCalendar /> }
        },
        {
          accessorKey: "closeStatus",
          header: "Status",
          cell: ({ row }) => (
            <PeriodCloseStatus status={row.original.closeStatus} />
          ),
          meta: { icon: <LuStar /> }
        },
        {
          accessorKey: "closedAt",
          header: "Closed",
          cell: ({ row }) =>
            row.original.closedAt ? formatDate(row.original.closedAt) : "—",
          meta: { icon: <LuCalendarCheck /> }
        }
      ],
      []
    );

    const renderContextMenu = useCallback(
      (row: AccountingPeriodListItem) => (
        <>
          {row.closeStatus === "Open" && (
            <MenuItem
              disabled={!permissions.can("update", "accounting")}
              onClick={() => submitIntent("lock", row.id)}
            >
              <MenuIcon icon={<LuLock />} />
              Lock
            </MenuItem>
          )}
          {row.closeStatus === "Locked" && (
            <MenuItem
              disabled={!permissions.can("update", "accounting")}
              onClick={() => submitIntent("unlock", row.id)}
            >
              <MenuIcon icon={<LuLockOpen />} />
              Unlock
            </MenuItem>
          )}
          {row.closeStatus !== "Closed" && (
            <MenuItem
              disabled={!permissions.can("update", "accounting")}
              onClick={() => navigate(path.to.accountingPeriodClose(row.id))}
            >
              <MenuIcon icon={<LuCalendarCheck />} />
              Close…
            </MenuItem>
          )}
          {row.closeStatus === "Closed" && (
            <MenuItem
              disabled={!permissions.can("delete", "accounting")}
              destructive
              onClick={() => {
                setSelectedPeriod(row);
                reopenModal.onOpen();
              }}
            >
              <MenuIcon icon={<LuRotateCcw />} />
              Reopen
            </MenuItem>
          )}
        </>
      ),
      [navigate, permissions, reopenModal, submitIntent]
    );

    return (
      <>
        <Table<AccountingPeriodListItem>
          data={data}
          columns={columns}
          count={count}
          primaryAction={primaryAction}
          renderContextMenu={renderContextMenu}
          title="Accounting Periods"
        />
        {selectedPeriod && (
          <Confirm
            isOpen={reopenModal.isOpen}
            title={`Reopen ${periodLabel(selectedPeriod)}`}
            text="Reopening allows posting into this period again. The action is recorded in the audit log."
            confirmText="Reopen"
            onCancel={() => {
              reopenModal.onClose();
              setSelectedPeriod(null);
            }}
            onSubmit={() => {
              submitIntent("reopen", selectedPeriod.id);
              reopenModal.onClose();
              setSelectedPeriod(null);
            }}
          />
        )}
      </>
    );
  }
);

AccountingPeriodsTable.displayName = "AccountingPeriodsTable";
export default AccountingPeriodsTable;
```

3. `index.ts`:

```typescript
export { default as AccountingPeriodsTable } from "./AccountingPeriodsTable";
export { default as PeriodCloseStatus } from "./PeriodCloseStatus";
```

4. Verify the `Confirm` modal's props signature against `~/components/Modals` (the depreciation-runs page uses `action=` for a form post; here we use `onSubmit` with a fetcher — if `Confirm` requires `action`, switch to a `fetcher.Form` inside a plain `Modal` following `ConfirmDelete.tsx`).

---

## Task 12: Route — `periods.tsx` (list + intent actions)

**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/periods.tsx`

**Steps:**

1. Full route:

```typescript
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Button, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { LuCirclePlus } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Outlet, redirect, useLoaderData } from "react-router";
import { usePermissions } from "~/hooks";
import {
  closeAccountingPeriod,
  createFiscalYearPeriods,
  getAccountingPeriods,
  getPeriodCloseReadiness,
  lockAccountingPeriod,
  reopenAccountingPeriod,
  unlockAccountingPeriod
} from "~/modules/accounting";
import { AccountingPeriodsTable } from "~/modules/accounting/ui/Periods";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Accounting Periods`,
  to: path.to.accountingPeriods
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const periods = await getAccountingPeriods(client, companyId);
  if (periods.error) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(periods.error, "Failed to load accounting periods")
      )
    );
  }

  const currentYear = new Date().getFullYear();
  const maxFiscalYear = (periods.data ?? []).reduce(
    (max, p) => Math.max(max, p.fiscalYear ?? 0),
    0
  );
  const nextFiscalYear = Math.max(maxFiscalYear + 1, currentYear);

  return {
    data: periods.data ?? [],
    count: periods.count ?? 0,
    nextFiscalYear
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  // Reopening a closed period is the highest-privilege operation
  const scope =
    intent === "reopen"
      ? ({ delete: "accounting" } as const)
      : ({ update: "accounting" } as const);
  const { client, companyId, userId } = await requirePermissions(
    request,
    scope
  );

  if (intent === "generate") {
    const fiscalYear = Number(formData.get("fiscalYear"));
    if (!Number.isInteger(fiscalYear)) {
      throw redirect(
        path.to.accountingPeriods,
        await flash(request, error(null, "Invalid fiscal year"))
      );
    }
    const result = await createFiscalYearPeriods(client, {
      companyId,
      fiscalYear,
      userId
    });
    if (result.error) {
      throw redirect(
        path.to.accountingPeriods,
        await flash(request, error(result.error, "Failed to generate periods"))
      );
    }
    throw redirect(
      path.to.accountingPeriods,
      await flash(request, success(`Generated periods for FY${fiscalYear}`))
    );
  }

  const periodId = String(formData.get("periodId"));
  if (!periodId) {
    throw redirect(
      path.to.accountingPeriods,
      await flash(request, error(null, "Period is required"))
    );
  }

  const args = { periodId, companyId, userId };
  let result: { data: unknown; error: { message: string } | null };
  let successMessage: string;

  switch (intent) {
    case "lock":
      result = await lockAccountingPeriod(client, args);
      successMessage = "Period locked";
      break;
    case "unlock":
      result = await unlockAccountingPeriod(client, args);
      successMessage = "Period unlocked";
      break;
    case "close": {
      const readiness = await getPeriodCloseReadiness(
        client,
        companyId,
        periodId
      );
      if (readiness.error) {
        throw redirect(
          path.to.accountingPeriods,
          await flash(
            request,
            error(readiness.error, "Failed to check close readiness")
          )
        );
      }
      if ((readiness.data?.blockers.length ?? 0) > 0) {
        throw redirect(
          path.to.accountingPeriods,
          await flash(
            request,
            error(
              null,
              `Cannot close: ${readiness.data!.blockers
                .map((b) => `${b.label} — ${b.count}`)
                .join("; ")}`
            )
          )
        );
      }
      result = await closeAccountingPeriod(client, args);
      successMessage = "Period closed";
      break;
    }
    case "reopen":
      result = await reopenAccountingPeriod(client, args);
      successMessage = "Period reopened";
      break;
    default:
      throw redirect(
        path.to.accountingPeriods,
        await flash(request, error(null, "Unknown intent"))
      );
  }

  if (result.error) {
    throw redirect(
      path.to.accountingPeriods,
      await flash(request, error(result.error, result.error.message))
    );
  }

  throw redirect(
    path.to.accountingPeriods,
    await flash(request, success(successMessage))
  );
}

export default function AccountingPeriodsRoute() {
  const { data, count, nextFiscalYear } = useLoaderData<typeof loader>();
  const permissions = usePermissions();

  return (
    <VStack spacing={0} className="h-full">
      <AccountingPeriodsTable
        data={data}
        count={count}
        primaryAction={
          permissions.can("update", "accounting") && (
            <Form method="post">
              <input type="hidden" name="intent" value="generate" />
              <input type="hidden" name="fiscalYear" value={nextFiscalYear} />
              <Button leftIcon={<LuCirclePlus />} variant="primary" type="submit">
                Generate FY{nextFiscalYear}
              </Button>
            </Form>
          )
        }
      />
      <Outlet />
    </VStack>
  );
}
```

---

## Task 13: Route — `periods.$periodId.close.tsx` (close drawer with readiness checklist)

**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/periods.$periodId.close.tsx`

**Steps:**

1. Full route (loader = readiness; the confirm posts `intent=close` to the parent action; modal-overlay child-route pattern per `payment-terms.new.tsx` / `ConfirmDelete`):

```typescript
import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle
} from "@carbon/react";
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate, useParams } from "react-router";
import { getPeriodCloseReadiness } from "~/modules/accounting";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { periodId } = params;
  if (!periodId) throw notFound("periodId not found");

  const readiness = await getPeriodCloseReadiness(client, companyId, periodId);
  if (readiness.error || !readiness.data) {
    throw notFound("Could not load close readiness");
  }

  return { readiness: readiness.data };
}

export default function ClosePeriodRoute() {
  const { readiness } = useLoaderData<typeof loader>();
  const { periodId } = useParams();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const [acknowledged, setAcknowledged] = useState(false);

  const hasBlockers = readiness.blockers.length > 0;
  const hasWarnings = readiness.warnings.length > 0;
  const canClose = !hasBlockers && (!hasWarnings || acknowledged);

  const onClose = () => navigate(path.to.accountingPeriods);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Close Accounting Period</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <div className="flex flex-col gap-4">
            {!hasBlockers && !hasWarnings && (
              <p className="text-sm text-muted-foreground">
                All readiness checks passed. Closing prevents any further
                posting into this period.
              </p>
            )}
            {readiness.blockers.map((b) => (
              <div key={b.key} className="text-sm text-destructive">
                Blocker: {b.label} — {b.count}
              </div>
            ))}
            {readiness.warnings.map((w) => (
              <div key={w.key} className="text-sm text-orange-500">
                Warning: {w.label} — {w.count}
              </div>
            ))}
            {hasWarnings && !hasBlockers && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={acknowledged}
                  onCheckedChange={(checked) =>
                    setAcknowledged(checked === true)
                  }
                />
                Close anyway — I have reviewed the warnings
              </label>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <fetcher.Form method="post" action={path.to.accountingPeriods}>
            <input type="hidden" name="intent" value="close" />
            <input type="hidden" name="periodId" value={periodId} />
            <Button
              type="submit"
              variant="primary"
              isDisabled={!canClose || fetcher.state !== "idle"}
              isLoading={fetcher.state !== "idle"}
            >
              Close Period
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
```

2. Verify `Checkbox` export name/props in `@carbon/react` (grep an existing usage) and adjust the `onCheckedChange` handler to match.

---

## Task 14: Sidebar entry

**Files:**
- Modify: `apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx`

**Steps:**

1. In the `Configure` group (lines ~98–149), directly above the `Fiscal Year` entry, add:

```typescript
    {
      name: t`Accounting Periods`,
      to: path.to.accountingPeriods,
      role: "employee",
      icon: <LuCalendarCheck />
    },
```

2. Add `LuCalendarCheck` to the `react-icons/lu` import.
3. Add `path.to.accountingPeriods` to the `accountingOnlyRoutes` set (lines ~25–33) so the page is gated behind accounting being enabled, matching the other GL pages.

---

## Task 15: Apply migration + SQL verification (requires local stack — coordinate with user)

**Steps:**

1. With the local stack up (`crbn up`):
   ```bash
   pnpm db:migrate
   # Expected: applies 20260702044133_period-close-lifecycle.sql without error
   ```
2. Discard the locally regenerated types/swagger (cloud-generated files must not gain a local diff):
   ```bash
   git checkout -- packages/database/src/types.ts
   git status --porcelain   # confirm no generated artifacts staged
   ```
3. Idempotency check (the deploy runner retries failed files over partial state):
   ```bash
   psql postgresql://supabase_admin:postgres@localhost:$PORT_DB/postgres \
     -f packages/database/supabase/migrations/20260702044133_period-close-lifecycle.sql
   # Expected: completes cleanly a second time (IF NOT EXISTS / OR REPLACE guards)
   ```
4. Trigger smoke test in psql:
   ```sql
   -- Close a test period, then attempt a service-role journal insert dated inside it:
   UPDATE "accountingPeriod" SET "closeStatus" = 'Closed' WHERE "id" = '<test-period-id>';
   INSERT INTO "journal" ("journalEntryId", "companyId", "postingDate", "createdBy")
   VALUES ('JE-TEST-000001', '<companyId>', '<date-in-period>', 'system');
   -- Expected: ERROR: Accounting period is closed for posting date <date>
   UPDATE "accountingPeriod" SET "closeStatus" = 'Open', "closedAt" = NULL WHERE "id" = '<test-period-id>';
   ```

---

## Task 16: Typecheck, lint, and gated e2e verification

**Steps:**

1. ```bash
   pnpm --filter @carbon/erp typecheck
   pnpm --filter @carbon/database typecheck
   pnpm --filter @carbon/utils typecheck
   pnpm run lint
   # Expected: all pass
   ```
2. E2E (requires user go-ahead; stack must be up): use the `/login` + `/test` skills to drive:
   - `/x/accounting/periods` renders periods grouped list; Generate FY button creates 12 periods.
   - Lock a period → receipt posting dated today fails with "period is locked"; manual JE posts fine.
   - Close flow: draft JE in period shows as blocker; after posting the draft, close succeeds; sequential rule blocks closing a later period first.
   - Reopen requires `delete: accounting`; reopening mid-history is blocked until later periods are open.
   - Screenshot the periods page and close drawer for the PR (feedback: surface designs with screenshots).
3. Update the spec: move acceptance-criteria checkboxes as they're verified; add changelog entry; keep spec implementation-accurate.

## Commit checkpoints

- After Tasks 1–8 (backend) pass typecheck: `feat(accounting): period close lifecycle — schema, services, posting gates`
- After Tasks 9–14 (UI) pass typecheck + lint: `feat(accounting): accounting periods page with lock/close/reopen`
- Commits only after the check-and-commit gate; PR references `Tracking spec: .ai/specs/2026-07-02-period-closing.md`.

## Deferred (explicit non-goals for v1, per spec)

- Per-subledger AR/AP/Inventory locks; 13th adjustment period; dead-letter UI for closed-period job failures; removal of the legacy Active/Inactive toggle; JournalEntryForm inline period warning (server-side error + flash covers v1). *(Persisted close-checklist tasks were un-deferred 2026-07-04 — see Addendum Tasks 17–20. Negative-inventory readiness is now seeded task 6's auto-check; posting-queue readiness is part of task 1's.)*

---

# Addendum (2026-07-04): NetSuite-style close checklist — Tasks 17–20

Spec reference: `.ai/specs/2026-07-02-period-closing.md` §"NetSuite-style close checklist". Execute after Tasks 1–16 (or fold Task 17's DDL into the Task 1 migration wave if it hasn't been applied yet — preferred).

## Task 17: Migration — checklist tables + seed

**Files:** extend `20260702044133_period-close-lifecycle.sql` if unapplied, else a new randomized-timestamp migration; `packages/database/supabase/functions/lib/seed.data.ts` + `seed-company` for new-company seeding.

1. Create `periodCloseTaskDefinition` + `periodCloseTask` exactly per the spec's SQL sketch (composite PKs, audit columns, `(companyId, accountingPeriodId, definitionId)` unique, indexes on `companyId`, `accountingPeriodId`).
2. Four standard RLS policies each: SELECT via `get_companies_with_employee_role()`, writes via `get_companies_with_employee_permission('accounting_*')`.
3. Seed the 9 system definitions (spec table: pending-postings, draft-journals, lock, draft-depreciation, unmatched-ic, negative-inventory, tb-balanced, review-statements, close) for every existing company (`isSystem = true`) and in `seed-company` for new ones. Idempotency-guard all DDL + seeds.
4. `pnpm run generate:types` before typechecking.

## Task 18: Service — checklist functions + close gating

**Files:** `apps/erp/app/modules/accounting/accounting.service.ts`, `accounting.models.ts`.

1. `getPeriodCloseChecklist(client, companyId, periodId)`: idempotent instantiation from active definitions (insert missing via the unique key, snapshot name/type/sort/required/severity, default assignee), then overlay live results from `getPeriodCloseReadiness` onto Auto tasks (check passes ⇒ effective status Done, `completedBy = null`), return ordered.
2. `completeCloseTask` / `skipCloseTask` (reject skip on Blocker autos; `skippedReason` required; both stamp user + timestamp) / `addCloseTask` (ad-hoc, `definitionId = null`).
3. Definition CRUD: `getPeriodCloseTaskDefinitions`, `upsertPeriodCloseTaskDefinition` (system rows: only `sortOrder`/`defaultAssigneeId`/`active` mutable), no hard delete for `isSystem`.
4. `closeAccountingPeriod` gains the checklist gate: every `required` task Done/Skipped AND no failing Blocker auto-check; on success persist final Auto-task states onto the rows in the same transaction.
5. Zod validators (`closeTaskCompleteValidator`, `closeTaskSkipValidator` with min-length reason, `periodCloseTaskDefinitionValidator`).

## Task 19: UI — close drawer becomes the checklist; periods row progress

**Files:** amend Task 13's `periods.$periodId.close.tsx`; `AccountingPeriodsTable` from Task 11; new `ui/Periods/PeriodCloseChecklist.tsx`.

1. Drawer renders ordered task rows: status icon (green check / red blocker / amber warning / gray open), name, assignee, per-type affordances — Auto: live state + drill link (draft JEs → journals list filtered; pending docs → posting queue; IC → intercompany match page); Action: Lock/Close buttons wired to the existing parent-route intents; Manual: Complete (notes/evidence optional) + Skip (reason modal). Route action handles `intent: complete | skip | add-task`.
2. Close button enabled per the Task 18 gate; blockers listed above it when disabled.
3. `AccountingPeriodsTable` row gains a "6/9" progress chip once a period has instantiated tasks.
4. Template management: `periods.checklist-settings.tsx` (Drawer) listing definitions with add/reorder/deactivate/default-assignee; `update: "accounting"`.

## Task 20: Verification additions

1. SQL: re-opening the drawer never duplicates tasks (unique-key upsert proven); closing persists Auto states.
2. E2E per the spec's new acceptance criteria: seeded 9 tasks appear; draft-JE blocker disables Close and its drill link resolves; warning skip requires reason; Blocker skip rejected server-side; custom template task appears in the NEXT period only; close records completedBy/At on manual tasks.
3. Update the Task 15/16 gates to include these; commit checkpoint: `feat(accounting): NetSuite-style period close checklist`.
