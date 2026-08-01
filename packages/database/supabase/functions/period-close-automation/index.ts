import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import z from "npm:zod@^3.24.1";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  companyId: z.string(),
  userId: z.string().default("system"),
});

// ---------------------------------------------------------------------------
// Account-class sign convention — the Deno mirror of @carbon/utils toStoredAmount.
// journalLine.amount is a class-signed natural balance:
//   debit>0  -> asset/expense: +debit,  liability/equity/revenue: -debit
//   credit>0 -> asset/expense: -credit, liability/equity/revenue: +credit
// (Kept intentionally tiny and pure; must stay in lockstep with packages/utils.)
// ---------------------------------------------------------------------------
function toStoredAmount(
  debit: number,
  credit: number,
  accountClass: string | null,
): number {
  const naturalDebit = accountClass === "Asset" || accountClass === "Expense";
  if (debit > 0) return naturalDebit ? debit : -debit;
  return naturalDebit ? -credit : credit;
}

async function accountClassMap(
  trx: any,
  companyId: string,
  accountIds: string[],
): Promise<Map<string, string | null>> {
  const ids = [...new Set(accountIds)];
  if (ids.length === 0) return new Map();
  const rows = await trx
    .selectFrom("account")
    .select(["id", "class"])
    .where("id", "in", ids)
    .execute();
  return new Map(rows.map((r: any) => [r.id, r.class]));
}

// Draft a journal + its lines inside an open transaction. Returns the new id.
async function draftJournal(
  trx: any,
  args: {
    companyId: string;
    userId: string;
    sourceType: string;
    postingDate: string;
    description: string;
    lines: Array<{ accountId: string; debit: number; credit: number }>;
  },
): Promise<string> {
  const journalEntryId = await getNextSequence(trx, "journalEntry", args.companyId);
  const inserted = await trx
    .insertInto("journal")
    .values({
      journalEntryId,
      companyId: args.companyId,
      description: args.description,
      postingDate: args.postingDate,
      sourceType: args.sourceType,
      status: "Draft",
      createdBy: args.userId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const classes = await accountClassMap(
    trx,
    args.companyId,
    args.lines.map((l) => l.accountId),
  );
  await trx
    .insertInto("journalLine")
    .values(
      args.lines.map((line) => ({
        journalId: inserted.id,
        accountId: line.accountId,
        amount: toStoredAmount(line.debit, line.credit, classes.get(line.accountId) ?? null),
        journalLineReference: crypto.randomUUID(),
        companyId: args.companyId,
      })),
    )
    .execute();
  return inserted.id;
}

// +1 / +3 / +12 months, day clamped to the target month (mirror advanceRecurringDate).
function advanceRecurringDate(dateStr: string, frequency: string): string {
  const step = frequency === "Annually" ? 12 : frequency === "Quarterly" ? 3 : 1;
  const [year, month, day] = dateStr.split("-").map(Number);
  const monthIndex = month - 1 + step;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12; // 0-based
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  const mm = String(targetMonth + 1).padStart(2, "0");
  const dd = String(targetDay).padStart(2, "0");
  return `${targetYear}-${mm}-${dd}`;
}

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  const today = format(new Date(), "yyyy-MM-dd");

  try {
    const { companyId, userId } = payloadValidator.parse(await req.json());
    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId,
    );

    const result = {
      prepaidDrafted: 0,
      recurringDrafted: 0,
      reversalsPosted: 0,
    };

    // 1. Prepaid amortization: draft one journal per due, undrafted entry under an
    //    Active schedule; stamp entry.journalId in the SAME txn (idempotency).
    const duePrepaid = await client
      .from("prepaidScheduleEntry")
      .select(
        "id, amortizationDate, amount, prepaidSchedule!inner(prepaidAccountId, expenseAccountId, description, status)",
      )
      .eq("companyId", companyId)
      .is("journalId", null)
      .lte("amortizationDate", today)
      .eq("prepaidSchedule.status", "Active");
    if (duePrepaid.error) throw new Error(duePrepaid.error.message);

    for (const entry of duePrepaid.data ?? []) {
      const schedule = (entry as any).prepaidSchedule;
      const amount = Number((entry as any).amount);
      await db.transaction().execute(async (trx) => {
        const journalId = await draftJournal(trx, {
          companyId,
          userId,
          sourceType: "Prepaid Amortization",
          postingDate: (entry as any).amortizationDate,
          description: `Prepaid amortization: ${schedule.description}`,
          lines: [
            { accountId: schedule.expenseAccountId, debit: amount, credit: 0 },
            { accountId: schedule.prepaidAccountId, debit: 0, credit: amount },
          ],
        });
        await trx
          .updateTable("prepaidScheduleEntry")
          .set({ journalId, updatedBy: userId })
          .where("id", "=", (entry as any).id)
          .where("companyId", "=", companyId)
          .execute();
      });
      result.prepaidDrafted++;
    }

    // 2. Recurring journals: draft from each due active template, advance nextRunDate.
    const dueRecurring = await client
      .from("recurringJournalTemplate")
      .select("*, recurringJournalTemplateLine(*)")
      .eq("companyId", companyId)
      .eq("active", true)
      .lte("nextRunDate", today);
    if (dueRecurring.error) throw new Error(dueRecurring.error.message);

    for (const template of dueRecurring.data ?? []) {
      const t = template as any;
      if (t.endDate && t.nextRunDate > t.endDate) continue;
      const lines = (t.recurringJournalTemplateLine ?? []).map((l: any) => ({
        accountId: l.accountId,
        debit: Number(l.debit ?? 0),
        credit: Number(l.credit ?? 0),
      }));
      const advanced = advanceRecurringDate(t.nextRunDate, t.frequency);
      const passedEnd = t.endDate != null && advanced > t.endDate;
      await db.transaction().execute(async (trx) => {
        await draftJournal(trx, {
          companyId,
          userId,
          sourceType: "Recurring Journal",
          postingDate: t.nextRunDate,
          description: t.name,
          lines,
        });
        await trx
          .updateTable("recurringJournalTemplate")
          .set({
            nextRunDate: advanced,
            active: !passedEnd,
            updatedBy: userId,
            updatedAt: new Date().toISOString(),
          })
          .where("id", "=", t.id)
          .where("companyId", "=", companyId)
          .execute();
      });
      result.recurringDrafted++;
    }

    // 3. Auto-reversing accruals: post the mirror on autoReverseOn (accounting
    //    source — Open/Locked target accepted, Closed skipped and retried later).
    const dueReversals = await client
      .from("journal")
      .select("id, journalEntryId, autoReverseOn")
      .eq("companyId", companyId)
      .eq("status", "Posted")
      .is("reversedById", null)
      .not("autoReverseOn", "is", null)
      .lte("autoReverseOn", today);
    if (dueReversals.error) throw new Error(dueReversals.error.message);

    for (const journal of dueReversals.data ?? []) {
      const j = journal as any;
      const reverseDate: string = j.autoReverseOn;

      // Resolve the target period for the reversal date. Accounting adjustments
      // may post into a Locked period; a Closed one is skipped (retried next run).
      const period = await client
        .from("accountingPeriod")
        .select("id, closeStatus, closedAt")
        .eq("companyId", companyId)
        .lte("startDate", reverseDate)
        .gte("endDate", reverseDate)
        .maybeSingle();
      const closeStatus =
        period.data?.closeStatus ?? (period.data?.closedAt ? "Closed" : "Open");
      if (period.data && closeStatus === "Closed") continue;

      const originalLines = await client
        .from("journalLine")
        .select("accountId, amount, description, companyId")
        .eq("journalId", j.id);
      if (originalLines.error) throw new Error(originalLines.error.message);

      await db.transaction().execute(async (trx) => {
        const journalEntryId = await getNextSequence(trx, "journalEntry", companyId);
        const reversed = await trx
          .insertInto("journal")
          .values({
            journalEntryId,
            companyId,
            description: `Reversal of ${j.journalEntryId}`,
            postingDate: reverseDate,
            accountingPeriodId: period.data?.id ?? null,
            sourceType: "Manual",
            reversalOfId: j.id,
            status: "Posted",
            postedAt: new Date().toISOString(),
            postedBy: userId,
            createdBy: userId,
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        const lines = (originalLines.data ?? []).map((line: any) => ({
          journalId: reversed.id,
          accountId: line.accountId,
          companyId: line.companyId,
          description: line.description,
          amount: -Number(line.amount),
          journalLineReference: crypto.randomUUID(),
        }));
        if (lines.length > 0) {
          await trx.insertInto("journalLine").values(lines).execute();
        }

        await trx
          .updateTable("journal")
          .set({ status: "Reversed", reversedById: reversed.id, updatedBy: userId })
          .where("id", "=", j.id)
          .execute();
      });
      result.reversalsPosted++;
    }

    console.log({ function: "period-close-automation", companyId, ...result });
    return jsonResponse({ success: true, ...result });
  } catch (err) {
    console.error("Error in period-close-automation:", err);
    return errorResponse(err);
  }
});
