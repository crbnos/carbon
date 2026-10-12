// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { hasPermission } from "@carbon/auth";
import { getUserClaims } from "@carbon/auth/users.server";
import { type Database, getCompanyTimeZone, type Json } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { serverFns } from "@carbon/server-functions";
import {
  cutLeasePaymentRows,
  type DraftedLeaseInvoice
} from "@carbon/server-functions/create-lease-invoices";
import { datetime, openEndedLeaseHorizon } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql, type Transaction } from "kysely";
import type { z } from "zod";
import { path } from "~/utils/path";
import {
  leaseLineColumns,
  leaseLinePaymentFields,
  type leaseLineValidator,
  leasePaymentTermFields,
  leaseTermColumns,
  type leaseValidator
} from "./purchasing.models";

/**
 * Server-only purchasing helpers: the lease writes that need a Kysely
 * transaction. Lives in a `.server.ts`, not the barrel-exported
 * `purchasing.service.ts`, because the module barrel is bundled for the
 * browser.
 */

type Trx = Transaction<KyselyDatabase>;

/** A Draft lease, locked for the rest of the transaction. Throws when it is
 *  missing or no longer a Draft: its rows were cut and measured at
 *  activation, and change only with Modify. */
async function lockDraftLease(
  trx: Trx,
  args: { leaseId: string; companyId: string; what: string }
) {
  const lease = await trx
    .selectFrom("lease")
    .select([
      "status",
      "currencyCode",
      "paymentFrequency",
      "paymentTiming",
      "annualEscalationPercent",
      sql<string>`"commencementDate"::text`.as("commencementDate"),
      sql<string | null>`"endDate"::text`.as("endDate"),
      sql<string>`"invoiceFromDate"::text`.as("invoiceFromDate")
    ])
    .where("id", "=", args.leaseId)
    .where("companyId", "=", args.companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!lease) throw new Error("Lease not found");
  if (lease.status !== "Draft") {
    throw new Error(
      `${args.what} changes only while the lease is Draft; modify an active lease instead`
    );
  }
  return lease;
}

/** Replaces the payment rows of a locked Draft lease's assets (one asset with
 *  `leaseLineId`) with the ones its terms cut (`cutLeasePaymentRows`). An
 *  asset with no payment has no rows. An open-ended lease is cut through one
 *  period past today (`openEndedLeaseHorizon`); the daily job rolls it
 *  forward from there. */
async function cutDraftLeasePayments(
  trx: Trx,
  args: {
    lease: Awaited<ReturnType<typeof lockDraftLease>>;
    leaseId: string;
    leaseLineId?: string;
    companyId: string;
    userId: string;
  }
): Promise<number> {
  const { lease, leaseId, companyId, userId } = args;
  let linesQuery = trx
    .selectFrom("leaseLine")
    .select([
      "id",
      "paymentAmount",
      "purchaseOptionAmount",
      "purchaseOptionReasonablyCertain"
    ])
    .where("leaseId", "=", leaseId)
    .where("companyId", "=", companyId);
  if (args.leaseLineId) {
    linesQuery = linesQuery.where("id", "=", args.leaseLineId);
  }
  const lines = await linesQuery.execute();
  if (args.leaseLineId && lines.length === 0) {
    throw new Error("Asset not found");
  }
  if (lines.length === 0) return 0;

  const currency = await trx
    .selectFrom("currency")
    .innerJoin("company", "company.companyGroupId", "currency.companyGroupId")
    .select("currency.decimalPlaces")
    .where("company.id", "=", companyId)
    .where("currency.code", "=", lease.currencyCode)
    .executeTakeFirst();
  if (!currency) {
    throw new Error(`Currency ${lease.currencyCode} is not set up`);
  }
  const through = lease.endDate
    ? undefined
    : openEndedLeaseHorizon(
        lease.commencementDate,
        datetime.today(await getCompanyTimeZone(trx, companyId)).toString(),
        lease.paymentFrequency
      );

  const rows = lines
    .filter((line) => line.paymentAmount > 0)
    .flatMap(
      (line) =>
        cutLeasePaymentRows({
          lease,
          asset: line,
          decimals: currency.decimalPlaces,
          through
        }).rows
    );

  await trx
    .deleteFrom("leasePayment")
    .where("leaseId", "=", leaseId)
    .where("companyId", "=", companyId)
    .where(
      "leaseLineId",
      "in",
      lines.map((line) => line.id)
    )
    .execute();
  if (rows.length > 0) {
    await trx
      .insertInto("leasePayment")
      .values(
        rows.map((row) => ({ ...row, leaseId, companyId, createdBy: userId }))
      )
      .execute();
  }
  return rows.length;
}

/** Whether any of `fields` differs between a saved row and its new values. */
function changed(
  saved: Record<string, unknown>,
  next: Record<string, unknown>,
  fields: readonly string[]
): boolean {
  return fields.some(
    (field) =>
      next[field] !== undefined &&
      String(saved[field] ?? "") !== String(next[field] ?? "")
  );
}

/**
 * Cuts a Draft lease's payment rows again from its terms, one set per asset
 * at the asset's payment amount, replacing the rows (and any edits to them)
 * in one transaction. Pass `leaseLineId` to cut one asset's rows only. A row
 * due before the lease's `invoiceFromDate` was paid outside Carbon and is
 * created `Skipped`, so the daily job never invoices it. A purchase option row
 * is added only when it is reasonably certain (it is then part of the lease
 * liability).
 */
export async function regenerateLeasePayments(
  db: Kysely<KyselyDatabase>,
  args: {
    leaseId: string;
    leaseLineId?: string;
    companyId: string;
    userId: string;
  }
): Promise<{ count: number }> {
  return db.transaction().execute(async (trx) => {
    const lease = await lockDraftLease(trx, {
      leaseId: args.leaseId,
      companyId: args.companyId,
      what: "A payment row"
    });
    return { count: await cutDraftLeasePayments(trx, { ...args, lease }) };
  });
}

/**
 * Saves a Draft lease's terms and, when a term the payment rows are cut from
 * changed (`leasePaymentTermFields`), cuts every asset's rows again — one
 * transaction, so the rows never describe terms the lease no longer has. An
 * invoice-from date that still equals the commencement follows a new one
 * (`resolveLeaseDates`). `customFields` replaces the stored set; leave it out
 * to keep it.
 */
export async function updateDraftLease(
  db: Kysely<KyselyDatabase>,
  args: {
    leaseId: string;
    companyId: string;
    userId: string;
    terms: Omit<z.infer<typeof leaseValidator>, "id" | "leaseId">;
    customFields?: Json;
  }
): Promise<{ paymentsCut: boolean }> {
  const { leaseId, companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    const saved = await lockDraftLease(trx, {
      leaseId,
      companyId,
      what: "A lease's terms"
    });
    const columns = leaseTermColumns(args.terms, saved);
    await trx
      .updateTable("lease")
      .set({
        ...columns,
        ...(args.customFields !== undefined
          ? { customFields: JSON.stringify(args.customFields) }
          : {}),
        updatedBy: userId,
        updatedAt: sql`now()`
      })
      .where("id", "=", leaseId)
      .where("companyId", "=", companyId)
      .execute();

    if (!changed(saved, columns, leasePaymentTermFields)) {
      return { paymentsCut: false };
    }
    await cutDraftLeasePayments(trx, {
      lease: { ...saved, ...columns },
      leaseId,
      companyId,
      userId
    });
    return { paymentsCut: true };
  });
}

/**
 * Adds an asset to a Draft lease (no `leaseLineId`) or changes one, and cuts
 * its payment rows again when it is new or a field they are cut from changed
 * (`leaseLinePaymentFields`) — one transaction. Only the asset's own fields
 * are written (`leaseLineColumns`), never its status, classification or
 * measurement.
 */
export async function saveDraftLeaseLine(
  db: Kysely<KyselyDatabase>,
  args: {
    leaseId: string;
    leaseLineId?: string;
    companyId: string;
    userId: string;
    line: Omit<z.infer<typeof leaseLineValidator>, "id" | "leaseId">;
  }
): Promise<{ id: string; paymentsCut: boolean }> {
  const { leaseId, companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    const lease = await lockDraftLease(trx, {
      leaseId,
      companyId,
      what: "A leased asset"
    });
    const columns = leaseLineColumns(args.line);

    let id: string;
    let recut: boolean;
    if (args.leaseLineId) {
      const saved = await trx
        .selectFrom("leaseLine")
        .select([...leaseLinePaymentFields])
        .where("id", "=", args.leaseLineId)
        .where("leaseId", "=", leaseId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!saved) throw new Error("Asset not found");
      await trx
        .updateTable("leaseLine")
        .set({ ...columns, updatedBy: userId, updatedAt: sql`now()` })
        .where("id", "=", args.leaseLineId)
        .where("leaseId", "=", leaseId)
        .where("companyId", "=", companyId)
        .execute();
      id = args.leaseLineId;
      recut = changed(saved, columns, leaseLinePaymentFields);
    } else {
      const last = await trx
        .selectFrom("leaseLine")
        .select((eb) => eb.fn.max("sortOrder").as("sortOrder"))
        .where("leaseId", "=", leaseId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      const inserted = await trx
        .insertInto("leaseLine")
        .values({
          ...columns,
          leaseId,
          sortOrder: Number(last?.sortOrder ?? 0) + 1,
          companyId,
          createdBy: userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      id = inserted.id;
      recut = true;
    }

    if (recut) {
      await cutDraftLeasePayments(trx, {
        lease,
        leaseId,
        leaseLineId: id,
        companyId,
        userId
      });
    }
    return { id, paymentsCut: recut };
  });
}

/** Returns the lease payment rows billed by these purchase invoice lines to
 *  Pending, so the next invoice run bills them again, stamped with who did
 *  it. The `purchaseInvoiceLine_release_lease_payment` trigger releases a
 *  row on ANY delete of its line (it cannot know the user); this runs first,
 *  so the trigger then finds nothing left to release. */
async function releaseLeasePayments(
  trx: Trx,
  args: { companyId: string; purchaseInvoiceLineIds: string[]; userId: string }
): Promise<void> {
  const { companyId, purchaseInvoiceLineIds, userId } = args;
  if (purchaseInvoiceLineIds.length === 0) return;
  await trx
    .updateTable("leasePayment")
    .set({
      status: "Pending",
      purchaseInvoiceLineId: null,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .where("companyId", "=", companyId)
    .where("purchaseInvoiceLineId", "in", purchaseInvoiceLineIds)
    .execute();
}

/**
 * Deletes a Draft purchase invoice and, in the same transaction, returns the
 * lease payment rows it billed to Pending (see `releaseLeasePayments`).
 * Checked here under a row lock, because releasing a POSTED invoice's rows
 * would bill them twice. Throws on a missing or non-Draft invoice.
 */
export async function deletePurchaseInvoiceReleasingLeases(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; invoiceId: string; userId: string }
): Promise<void> {
  const { companyId, invoiceId, userId } = args;
  await db.transaction().execute(async (trx) => {
    const invoice = await trx
      .selectFrom("purchaseInvoice")
      .select(["id", "status"])
      .where("id", "=", invoiceId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!invoice) throw new Error("Purchase invoice not found");
    if (invoice.status !== "Draft") {
      throw new Error(
        `Cannot delete purchase invoice with status "${invoice.status}". Only Draft invoices can be deleted.`
      );
    }

    const lines = await trx
      .selectFrom("purchaseInvoiceLine")
      .select("id")
      .where("invoiceId", "=", invoiceId)
      .where("companyId", "=", companyId)
      .where("leasePaymentId", "is not", null)
      .execute();
    await releaseLeasePayments(trx, {
      companyId,
      purchaseInvoiceLineIds: lines.map((line) => line.id),
      userId
    });

    await trx
      .deleteFrom("purchaseInvoice")
      .where("id", "=", invoiceId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

/** One line of a Draft purchase invoice, returning the lease payment row it
 *  billed to Pending (see `deletePurchaseInvoiceReleasingLeases`). The line
 *  must belong to `invoiceId` and that invoice must be Draft — checked here,
 *  under a row lock. Throws otherwise. */
export async function deletePurchaseInvoiceLineReleasingLeases(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    invoiceId: string;
    purchaseInvoiceLineId: string;
    userId: string;
  }
): Promise<void> {
  const { companyId, invoiceId, purchaseInvoiceLineId, userId } = args;
  await db.transaction().execute(async (trx) => {
    const line = await trx
      .selectFrom("purchaseInvoiceLine")
      .innerJoin("purchaseInvoice", (join) =>
        join
          .onRef("purchaseInvoice.id", "=", "purchaseInvoiceLine.invoiceId")
          .onRef(
            "purchaseInvoice.companyId",
            "=",
            "purchaseInvoiceLine.companyId"
          )
      )
      .select([
        "purchaseInvoiceLine.invoiceId as invoiceId",
        "purchaseInvoice.status as status"
      ])
      .where("purchaseInvoiceLine.id", "=", purchaseInvoiceLineId)
      .where("purchaseInvoiceLine.companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!line || line.invoiceId !== invoiceId) {
      throw new Error("Purchase invoice line not found on this invoice");
    }
    if (line.status !== "Draft") {
      throw new Error(
        `Cannot delete a line of a purchase invoice with status "${line.status}". Only Draft invoices can be edited.`
      );
    }

    await releaseLeasePayments(trx, {
      companyId,
      purchaseInvoiceLineIds: [purchaseInvoiceLineId],
      userId
    });
    await trx
      .deleteFrom("purchaseInvoiceLine")
      .where("id", "=", purchaseInvoiceLineId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

/** The date a lease that commenced before the accounting cutover opens on, as
 *  `post-lease` activate resolves it (`resolveAccountingPeriod`,
 *  "historical-with-shift"): the cutover, or the first day of the first open
 *  period after it when the cutover's period is locked or closed. Read only —
 *  activation is what locks or opens the period — so the Draft's Skipped
 *  payment check (`skippedPaymentBlockers`) matches activation. */
export async function leaseOpeningAsOf(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; cutoverDate: string }
): Promise<string> {
  const { companyId, cutoverDate } = args;
  const period = await db
    .selectFrom("accountingPeriod")
    .select(["closeStatus", "closedAt"])
    .where("companyId", "=", companyId)
    .where("startDate", "<=", cutoverDate)
    .where("endDate", ">=", cutoverDate)
    .orderBy("startDate")
    .orderBy("id")
    .executeTakeFirst();
  const closed =
    period &&
    (period.closeStatus === "Locked" ||
      period.closeStatus === "Closed" ||
      period.closedAt !== null);
  if (!closed) return cutoverDate;
  const next = await db
    .selectFrom("accountingPeriod")
    .select(sql<string>`"startDate"::text`.as("startDate"))
    .where("companyId", "=", companyId)
    .where("startDate", ">", cutoverDate)
    .where("closeStatus", "=", "Open")
    .where("closedAt", "is", null)
    .orderBy("startDate")
    .orderBy("id")
    .executeTakeFirst();
  // With no open period after it, activation refuses; the cutover stands.
  return next?.startDate ?? cutoverDate;
}

/** The lease page's "Invoice": drafts the purchase invoices the lease has
 *  due, exactly as the daily job would — the `create-lease-invoices` server
 *  function. */
export async function generateLeaseInvoicesNow(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    /** `YYYY-MM-DD` in the company's timezone. */
    asOf: string;
    leaseId: string;
  }
): Promise<{ invoices: DraftedLeaseInvoice[]; invoiceIds: string[] }> {
  const { companyId, userId, asOf, leaseId } = args;
  const { invoices, invoiceIds, failures } = await serverFns
    .system({ db, companyId, userId })
    .invokeOrThrow("create-lease-invoices", { asOf, leaseId });
  // One lease is billed here, so its failure is the action's failure.
  if (failures.length > 0) {
    throw new Error(failures.map((f) => f.error).join("; "));
  }
  return { invoices, invoiceIds };
}

/** Where a Draft lease is worked on: its setup wizard, for someone who can
 *  edit it. Null for any other lease, or a viewer, who sees the lease page —
 *  as `draftRentalAgreementSetupPath`. */
export async function draftLeaseSetupPath(
  client: SupabaseClient<Database>,
  args: { companyId: string; userId: string; id: string }
): Promise<string | null> {
  const { companyId, userId, id } = args;
  const [lease, claims] = await Promise.all([
    client
      .from("lease")
      .select("status")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle(),
    getUserClaims(userId, companyId)
  ]);
  if (lease.data?.status !== "Draft") return null;
  if (!hasPermission(claims?.permissions, "purchasing", "update", companyId)) {
    return null;
  }
  return path.to.leaseSetup(id, "assets");
}
