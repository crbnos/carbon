// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { statusWriteGuarded } from "./status-write-guarded";

const STATUS_SERVICE = "apps/erp/app/modules/accounting/accounting.service.ts";

const enumOf = (name: string) => `Database["public"]["Enums"]["${name}"]`;

// The shape the generated types give the check: a column → its type text.
const STATUS_TYPES = new Map<string, Map<string, string>>([
  [
    "accountingPeriod",
    new Map([
      ["id", "string"],
      ["closeStatus", enumOf("periodCloseStatus")],
      ["lockedAt", "string | null"]
    ])
  ],
  ["quote", new Map([["status", enumOf("quoteStatus")]])],
  ["salesInvoice", new Map([["status", enumOf("salesInvoiceStatus")]])],
  ["receipt", new Map([["status", enumOf("receiptStatus")]])],
  [
    "leasePayment",
    new Map([
      ["status", enumOf("leasePaymentStatus")],
      ["purchaseInvoiceLineId", "string | null"]
    ])
  ],
  ["trackedEntity", new Map([["status", enumOf("trackedEntityStatus")]])],
  ["employeeJob", new Map([["flsaStatus", enumOf("flsaStatus")]])],
  [
    "salesOrderStatusHistory",
    new Map([["status", enumOf("salesOrderStatus")]])
  ],
  ["note", new Map([["status", "string"]])]
]);

const statusScan = (ts: string, file = STATUS_SERVICE) =>
  statusWriteGuarded.find({
    files: [{ file, contents: ts }],
    columnTypes: STATUS_TYPES
  });
const statusSnippets = (ts: string, file = STATUS_SERVICE) =>
  statusScan(ts, file).map((v) => v.snippet);

// `git show de82a88cc6^:apps/erp/app/modules/accounting/accounting.service.ts`,
// lines 3478–3550: both functions read closeStatus, check it in code, then
// update by id alone. An unlock queued behind a close set the Closed period
// back to Open.
const DE82A88CC6_PARENT = `/** Not published: \`accounting_lockPeriod\` runs it. */
export async function lockAccountingPeriod(
  client: SupabaseClient<Database>,
  args: { periodId: string; companyId: string; userId: string }
) {
  const cutover = await requireAccountingCutover(client, args.companyId);
  if (cutover.error) return { data: null, error: cutover.error };
  const period = await getAccountingPeriodById(
    client,
    args.periodId,
    args.companyId
  );
  if (period.error || !period.data) {
    return {
      data: null,
      error: period.error ?? { message: "Period not found" }
    };
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

/** Not published: \`accounting_unlockPeriod\` runs it. */
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
    return {
      data: null,
      error: period.error ?? { message: "Period not found" }
    };
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
`;

// `git show de82a88cc6:…/accounting.service.ts`, the fixed setPeriodCloseStatus
// (lines 3545–3568): the UPDATE names the status it moves from.
const DE82A88CC6_FIX = `async function setPeriodCloseStatus(
  client: SupabaseClient<Database>,
  args: { periodId: string; companyId: string; userId: string },
  move: { from: "Open" | "Locked"; to: "Open" | "Locked" },
  columns: { lockedAt: string | null; lockedBy: string | null },
  refusal: string
) {
  const result = await client
    .from("accountingPeriod")
    .update({
      closeStatus: move.to,
      ...columns,
      updatedBy: args.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", args.periodId)
    .eq("companyId", args.companyId)
    .eq("closeStatus", move.from)
    .select("id")
    .maybeSingle();
  if (result.error) return { data: null, error: result.error };
  if (!result.data) return { data: null, error: { message: refusal } };
  return { data: result.data, error: null };
}
`;

// `git show 2c9ef0dd8f^:packages/database/supabase/functions/convert/index.ts`,
// lines 672–683: a replayed accept moved an Ordered quote again and made a
// second sales order.
const CONVERT = "packages/database/supabase/functions/convert/index.ts";
const C2C9EF0DD8F_PARENT = `          const newQuoteStatus: "Ordered" | "Partial" = hasZeroQuantityLines
            ? "Partial"
            : "Ordered";
          await trx
            .updateTable("quote")
            .set({
              status: newQuoteStatus,
              digitalQuoteAcceptedBy: digitalQuoteAcceptedBy ?? null,
              digitalQuoteAcceptedByEmail: digitalQuoteAcceptedByEmail ?? null,
            })
            .where("id", "=", quote.data.id)
            .execute();
`;

// `git show 2c9ef0dd8f:…/convert/index.ts`, lines 672–695.
const C2C9EF0DD8F_FIX = `          const newQuoteStatus: "Ordered" | "Partial" = hasZeroQuantityLines
            ? "Partial"
            : "Ordered";
          // Atomic guard: only convert a quote that is still "Sent". Both the
          // internal "convert to order" flow and the unauthenticated digital
          // quote accept run from "Sent" only. If a concurrent or replayed
          // request already converted it, 0 rows update here and the throw rolls
          // the whole transaction back — no duplicate sales order is committed.
          const quoteStatusUpdate = await trx
            .updateTable("quote")
            .set({
              status: newQuoteStatus,
              digitalQuoteAcceptedBy: digitalQuoteAcceptedBy ?? null,
              digitalQuoteAcceptedByEmail: digitalQuoteAcceptedByEmail ?? null,
            })
            .where("id", "=", quote.data.id)
            .where("status", "=", "Sent")
            .executeTakeFirst();

          if (Number(quoteStatusUpdate.numUpdatedRows ?? 0) === 0) {
            throw new Error(
              \`Quote \${quote.data.id} is no longer in a convertible state\`
            );
          }
`;

// `git show 578c411ffe^:apps/erp/app/modules/invoicing/invoicing.service.ts`:
// the void branch of postSalesInvoice (from line 9516), its lock (lines
// 11066–11077) and its status write (11629–11640). The lock reads only `id`,
// so a second void waited for the first and then reversed the invoice again.
// The fix reached main squashed into b6ca51d4e1 (#2337), the sha that stays
// reachable once the branch is gone.
const INVOICING = "apps/erp/app/modules/invoicing/invoicing.service.ts";
const VOID_HEAD = `export async function postSalesInvoice(
  ctx: ServiceContext,
  raw: z.input<typeof postSalesInvoiceInput>
) {
  const { type, invoiceId } = postSalesInvoiceInput.parse(raw);
`;
const VOID_WRITE = `          // Update invoice status to voided
          await trx
            .updateTable("salesInvoice")
            .set({
              status: "Voided",
              updatedAt: today,
              updatedBy: userId
            })
            .where("id", "=", invoiceId)
            .where("companyId", "=", companyId)
            .execute();
        });
}
`;
const C578C411FFE_PARENT = `${VOID_HEAD}        await db.transaction().execute(async (trx) => {
          await assertPostingStatusUnchanged(trx, companyId, postingStatus);
          // Locked before the journal is read, as a line account change locks
          // it before it adds lines: those are reversed with the rest, never
          // left on a voided invoice.
          await trx
            .selectFrom("salesInvoice")
            .select("id")
            .where("id", "=", invoiceId)
            .where("companyId", "=", companyId)
            .forUpdate()
            .execute();
${VOID_WRITE}`;

// `git show 578c411ffe:…/invoicing.service.ts`, lines 11066–11081: the same
// lock reads the status and refuses a Voided invoice.
const C578C411FFE_FIX = `${VOID_HEAD}        await db.transaction().execute(async (trx) => {
          await assertPostingStatusUnchanged(trx, companyId, postingStatus);
          // Locked before the journal is read, as a line account change locks
          // it before it adds lines: those are reversed with the rest, never
          // left on a voided invoice.
          const locked = await trx
            .selectFrom("salesInvoice")
            .select("status")
            .where("id", "=", invoiceId)
            .where("companyId", "=", companyId)
            .forUpdate()
            .executeTakeFirst();
          if (locked?.status === "Voided") {
            throw new InvalidInputError("Sales invoice is already voided");
          }
${VOID_WRITE}`;

describe("statusWriteGuarded: the shipped bugs", () => {
  it("flags lock and unlock from before de82a88cc6", () => {
    const v = statusScan(DE82A88CC6_PARENT);
    expect(v.map((x) => x.snippet)).toEqual([
      "lockAccountingPeriod: accountingPeriod.closeStatus",
      "unlockAccountingPeriod: accountingPeriod.closeStatus"
    ]);
    expect(v.map((x) => x.line)).toEqual([27, 63]);
    expect(v[0]?.message).toContain('.eq("closeStatus", <expected>)');
    expect(v[0]?.message).toContain("FOR UPDATE");
  });

  it("passes the de82a88cc6 fix", () => {
    expect(statusScan(DE82A88CC6_FIX)).toEqual([]);
  });

  it("flags the quote conversion from before 2c9ef0dd8f", () => {
    expect(statusSnippets(C2C9EF0DD8F_PARENT, CONVERT)).toEqual([
      "<top level>: quote.status"
    ]);
  });

  it("passes the 2c9ef0dd8f fix", () => {
    expect(statusScan(C2C9EF0DD8F_FIX, CONVERT)).toEqual([]);
  });

  it("flags the void from before 578c411ffe (b6ca51d4e1 on main), which locked the invoice and never read its status", () => {
    const v = statusScan(C578C411FFE_PARENT, INVOICING);
    expect(v.map((x) => [x.line, x.snippet])).toEqual([
      [22, "postSalesInvoice: salesInvoice.status"]
    ]);
    expect(v[0]?.message).toContain("nothing reads status under that lock");
  });

  it("passes the 578c411ffe fix", () => {
    expect(statusScan(C578C411FFE_FIX, INVOICING)).toEqual([]);
  });
});

describe("statusWriteGuarded", () => {
  it("accepts each spelling of a status predicate", () => {
    const writes = [
      '.eq("status", "Draft")',
      '.neq("status", "Voided")',
      '.in("status", ["Draft", "Pending"])',
      '.is("status", null)'
    ];
    for (const filter of writes) {
      const ts = `export async function post(client) {
  await client.from("receipt").update({ status: "Pending" }).eq("id", id)${filter};
}`;
      expect(statusScan(ts), filter).toEqual([]);
    }
    const kysely = `export async function post(trx) {
  await trx.updateTable("receipt as r").set({ status: "Posted" }).where("r.id", "=", id).where("r.status", "=", "Pending").execute();
}`;
    expect(statusScan(kysely)).toEqual([]);
  });

  it("follows a predicate added to a builder held in a variable", () => {
    const ts = `export async function updateReceiptStatus(client, { id, status, expected }) {
  let query = client
    .from("receipt")
    .update({ status })
    .eq("id", id);
  if (expected) query = query.eq("status", expected);
  return query.select("id").single();
}`;
    expect(statusScan(ts)).toEqual([]);
  });

  it("passes a write after the function locked a row of the same table", () => {
    const ts = `export async function voidReceipt(trx, id) {
  const locked = await trx.selectFrom("receipt").select("status").where("id", "=", id).forUpdate().executeTakeFirst();
  if (locked?.status !== "Posted") throw new Error("not posted");
  await trx.updateTable("receipt").set({ status: "Voided" }).where("id", "=", id).execute();
}`;
    expect(statusScan(ts)).toEqual([]);
  });

  it("counts a lock whose select reads the status, or a read of it after the lock", () => {
    const guarded = [
      `const locked = await trx.selectFrom("receipt").select(["id", "status"]).where("id", "=", id).forUpdate().executeTakeFirst();`,
      `const locked = await trx.selectFrom("receipt as r").select("r.status as current").where("r.id", "=", id).forUpdate().executeTakeFirst();`,
      `const locked = await trx.selectFrom("receipt").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();`,
      `const locked = await trx.selectFrom("receipt").select("id").where("id", "=", id).where("status", "=", "Posted").forUpdate().executeTakeFirst();`,
      `await sql\`SELECT "id" FROM "receipt" WHERE "id" = \${id} AND "status" = 'Posted' FOR UPDATE\`.execute(trx);`,
      `await trx.selectFrom("receipt").select("id").where("id", "=", id).forUpdate().execute();
  const current = await trx.selectFrom("receipt").select("status").where("id", "=", id).executeTakeFirst();`,
      `const { rows } = await sql\`SELECT * FROM "receipt" WHERE "id" = \${id} FOR UPDATE\`.execute(trx);`
    ];
    for (const lock of guarded) {
      const ts = `export async function voidReceipt(trx, id) {
  ${lock}
  await trx.updateTable("receipt").set({ status: "Voided" }).where("id", "=", id).execute();
}`;
      expect(statusScan(ts), lock).toEqual([]);
    }
  });

  it("flags a lock that reads no status, as SQL or through a helper", () => {
    const blind = [
      `await sql\`SELECT "id" FROM "receipt" WHERE "id" = \${id} FOR UPDATE\`.execute(trx);`,
      "await lockReceipt(trx, id);",
      `const locked = await trx.selectFrom("receipt").select("id").where("id", "=", id).forUpdate().executeTakeFirst();
  if (!locked) throw new Error("not found");`
    ];
    for (const lock of blind) {
      const ts = `async function lockReceipt(trx, id) {
  return trx.selectFrom("receipt").select("id").where("id", "=", id).forUpdate().executeTakeFirst();
}

export async function voidReceipt(trx, id) {
  ${lock}
  await trx.updateTable("receipt").set({ status: "Voided" }).where("id", "=", id).execute();
}`;
      expect(statusSnippets(ts), lock).toEqual(["voidReceipt: receipt.status"]);
    }
  });

  it("passes a helper's lock when the caller reads the status of the row it returns", () => {
    const ts = `async function lockReceipt(trx, id) {
  return trx.selectFrom("receipt").selectAll("receipt").where("id", "=", id).forUpdate().executeTakeFirst();
}

export async function voidReceipt(trx, id) {
  const receipt = await lockReceipt(trx, id);
  if (receipt?.status !== "Posted") throw new Error("not posted");
  await trx.updateTable("receipt").set({ status: "Voided" }).where("id", "=", id).execute();
}`;
    expect(statusScan(ts)).toEqual([]);
  });

  it("does not take a lock on another table, or a lock taken after the write", () => {
    const otherTable = `export async function voidReceipt(trx, id) {
  await trx.selectFrom("purchaseOrder").select("id").where("id", "=", poId).forUpdate().execute();
  await trx.updateTable("receipt").set({ status: "Voided" }).where("id", "=", id).execute();
}`;
    expect(statusSnippets(otherTable)).toEqual(["voidReceipt: receipt.status"]);
    const lockedAfter = `export async function voidReceipt(trx, id) {
  await trx.updateTable("receipt").set({ status: "Voided" }).where("id", "=", id).execute();
  await trx.selectFrom("receipt").select("id").where("id", "=", id).forUpdate().execute();
}`;
    expect(statusSnippets(lockedAfter)).toEqual([
      "voidReceipt: receipt.status"
    ]);
  });

  it("does not let a lock in one function stand for a write in another", () => {
    const ts = `export async function lockIt(trx, id) {
  await trx.selectFrom("receipt").select("id").where("id", "=", id).forUpdate().execute();
}

export async function voidReceipt(trx, id) {
  await trx.updateTable("receipt").set({ status: "Voided" }).where("id", "=", id).execute();
}`;
    expect(statusSnippets(ts)).toEqual(["voidReceipt: receipt.status"]);
  });

  it("passes a write after a same-file helper that locks the table", () => {
    const ts = `async function lockReceipt(trx, id) {
  return trx.selectFrom("receipt").select("status").where("id", "=", id).forUpdate().executeTakeFirst();
}

export async function voidReceipt(trx, id) {
  const receipt = await lockReceipt(trx, id);
  if (receipt?.status !== "Posted") throw new Error("not posted");
  await trx.updateTable("receipt").set({ status: "Voided" }).where("id", "=", id).execute();
}`;
    expect(statusScan(ts)).toEqual([]);
  });

  it("finds a lock on a query held in a variable and locked on a later line", () => {
    const ts = `export async function voidReceipt(trx, id) {
  let query = trx.selectFrom("receipt").select("status").where("id", "=", id);
  if (!dryRun) query = query.forUpdate();
  await query.executeTakeFirst();
  await trx.updateTable("receipt").set({ status: "Voided" }).where("id", "=", id).execute();
}`;
    expect(statusScan(ts)).toEqual([]);
  });

  it("passes an UPDATE that filters on another column it changes", () => {
    const ts = `async function releaseLeasePayments(trx, ids) {
  await trx
    .updateTable("leasePayment")
    .set({ status: "Pending", purchaseInvoiceLineId: null, updatedBy: userId })
    .where("companyId", "=", companyId)
    .where("purchaseInvoiceLineId", "in", ids)
    .execute();
}`;
    expect(statusScan(ts)).toEqual([]);
  });

  it("does not count an audit column as that claim", () => {
    const ts = `async function consume(trx, ids) {
  await trx.updateTable("trackedEntity").set({ status: "Consumed", updatedBy: userId }).where("id", "in", ids).where("updatedBy", "=", userId).execute();
}`;
    expect(statusSnippets(ts)).toEqual(["consume: trackedEntity.status"]);
  });

  it("reads status rows built for updateRowsById, which has no predicate of its own", () => {
    const ts = `export async function consumeAll(trx, entities) {
  const updates = [];
  for (const entity of entities) {
    updates.push({ id: entity.id, data: { status: "Consumed" } });
  }
  await updateRowsById(trx, "trackedEntity", companyId, updates);
}`;
    expect(statusSnippets(ts)).toEqual(["consumeAll: trackedEntity.status"]);
  });

  it("reads a row object built in a local and its later member writes", () => {
    const ts = `export async function setAsset(client, id) {
  const update: Database["public"]["Tables"]["receipt"]["Update"] = {
    updatedBy: userId
  };
  if (done) update.status = "Posted";
  await client.from("receipt").update(update).eq("id", id);
}`;
    expect(statusSnippets(ts)).toEqual(["setAsset: receipt.status"]);
  });

  it("reads the updateRows filter", () => {
    const guarded =
      'await updateRows(trx, "receipt", { status: "Posted" }, { id, companyId, status: "Pending" });';
    expect(statusScan(guarded)).toEqual([]);
    const unguarded =
      'await updateRows(trx, "receipt", { status: "Posted" }, { id, companyId });';
    expect(
      statusSnippets(`export async function post(trx) {\n  ${unguarded}\n}`)
    ).toEqual(["post: receipt.status"]);
  });

  it("names a class method in the snippet, and keeps a lock to its method", () => {
    const ts = `export class InvoiceSyncer {
  async lock(tx, id) {
    await tx.selectFrom("receipt").select("id").where("id", "=", id).forUpdate().execute();
  }

  async upsertLocal(tx, id, data) {
    await tx.updateTable("receipt").set({ status: data.status }).where("id", "=", id).execute();
  }
}`;
    expect(statusSnippets(ts)).toEqual([
      "InvoiceSyncer.upsertLocal: receipt.status"
    ]);
  });

  it("ignores status-named columns that are not a lifecycle", () => {
    const ts = `export async function edit(trx) {
  await trx.updateTable("employeeJob").set({ flsaStatus: "Exempt" }).where("id", "=", id).execute();
  await trx.updateTable("salesOrderStatusHistory").set({ status: "Confirmed" }).where("id", "=", id).execute();
  await trx.updateTable("note").set({ status: "x" }).where("id", "=", id).execute();
}`;
    expect(statusScan(ts)).toEqual([]);
  });

  it("ignores inserts, reads and comments", () => {
    const ts = `export async function create(trx) {
  // await trx.updateTable("receipt").set({ status: "Posted" }).where("id", "=", id).execute();
  await trx.insertInto("receipt").values({ status: "Draft" }).execute();
  await client.from("receipt").select("status").eq("id", id);
  await client.from("receipt").upsert({ status: "Draft" });
}`;
    expect(statusScan(ts)).toEqual([]);
  });
});
