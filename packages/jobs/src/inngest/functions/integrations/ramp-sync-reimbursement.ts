import type { Database } from "@carbon/database";
import type { KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { createMappingService } from "@carbon/ee/accounting";
import {
  codeSelections,
  type RampReimbursement,
  resolveEmployeeSupplier
} from "@carbon/ee/ramp.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Kysely, sql } from "kysely";
import { createOrResumeRampPayment } from "./ramp-sync-payment";

type PaymentStatus = Database["public"]["Enums"]["paymentStatus"];
type PurchaseInvoiceStatus =
  Database["public"]["Enums"]["purchaseInvoiceStatus"];

export type RampReimbursementInvoiceLine = {
  accountId: string;
  costCenterId: string | null;
  amount: number;
  description: string | null;
};

export type RampReimbursementInvoiceDraft = {
  companyId: string;
  actorId: string;
  reimbursementRemoteId: string;
  supplierId: string;
  supplierReference: string;
  currencyCode: string;
  exchangeRate: number;
  dateIssued: string | null;
  dateDue: string | null;
  lines: RampReimbursementInvoiceLine[];
};

export type StagedRampReimbursementInvoice = {
  invoiceRowId: string;
  readableInvoiceId: string;
  status: PurchaseInvoiceStatus;
  currencyCode: string;
  exchangeRate: number;
  created: boolean;
};

type SyncItem = { id: string; referenceId: string; deepLinkUrl?: string };
type FailItem = { id: string; message: string };
type NormalizedAmount =
  | { ok: true; value: number }
  | { ok: false; error: string };

export type RampReimbursementDependencies = {
  companyId: string;
  actorId: string;
  baseCurrency: string;
  companyGroupId: string | null;
  reimbursementBankAccountId?: string | null;
  statementBankAccountId?: string | null;
  db: Kysely<KyselyDatabase>;
  client: SupabaseClient<Database>;
  getDecimals: (currencyCode: string) => Promise<number>;
  getExchangeRate: (currencyCode: string) => Promise<number>;
  normalizeAmount: (
    value: unknown,
    currencyCode: string,
    label: string
  ) => Promise<NormalizedAmount>;
  postInvoice: (
    invoiceRowId: string
  ) => Promise<{ readableId: string } | { fail: string }>;
  invoiceDeepLinkUrl: (invoiceRowId: string) => string;
};

// Reimbursement.state in Ramp's OpenAPI contract (2026-09-11). Only verified
// Ramp-paid states authorize a bank settlement; other payment/export states
// remain unsupported until their accounting semantics are established.
const REIMBURSEMENT_PAID_STATES = new Set([
  "REIMBURSED",
  "REIMBURSED_VIA_PUSH"
]);
const REIMBURSEMENT_INVOICE_ONLY_STATES = new Set([
  "APPROVED",
  "AWAITING_PAYMENT",
  "AWAITING_PUSH_PAYMENT",
  "MANUALLY_REIMBURSED"
]);

async function loadDraftStructure(
  tx: KyselyTx,
  companyId: string,
  invoiceRowId: string
): Promise<{ hasDelivery: boolean; lineCount: number }> {
  const delivery = await tx
    .selectFrom("purchaseInvoiceDelivery")
    .select("id")
    .where("id", "=", invoiceRowId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  const lines = await tx
    .selectFrom("purchaseInvoiceLine")
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .where("invoiceId", "=", invoiceRowId)
    .where("companyId", "=", companyId)
    .executeTakeFirstOrThrow();
  return { hasDelivery: Boolean(delivery), lineCount: Number(lines.count) };
}

async function repairLegacyDraft(
  tx: KyselyTx,
  args: RampReimbursementInvoiceDraft,
  invoiceRowId: string
): Promise<void> {
  const structure = await loadDraftStructure(tx, args.companyId, invoiceRowId);
  if (structure.hasDelivery && structure.lineCount > 0) return;
  await tx
    .deleteFrom("purchaseInvoiceLine")
    .where("invoiceId", "=", invoiceRowId)
    .where("companyId", "=", args.companyId)
    .execute();
  if (!structure.hasDelivery) {
    await tx
      .insertInto("purchaseInvoiceDelivery")
      .values({
        id: invoiceRowId,
        companyId: args.companyId,
        supplierShippingCost: 0
      })
      .execute();
  }
  await insertInvoiceLines(tx, args, invoiceRowId);
}

async function insertInvoiceLines(
  tx: KyselyTx,
  args: RampReimbursementInvoiceDraft,
  invoiceRowId: string
): Promise<void> {
  if (args.lines.length === 0) {
    throw new Error("Ramp reimbursement requires at least one coded line");
  }
  await tx
    .insertInto("purchaseInvoiceLine")
    .values(
      args.lines.map((line, index) => ({
        invoiceId: invoiceRowId,
        invoiceLineType: "G/L Account" as const,
        accountId: line.accountId,
        costCenterId: line.costCenterId,
        description: line.description,
        quantity: 1,
        supplierUnitPrice: line.amount,
        exchangeRate: args.exchangeRate,
        sortOrder: index + 1,
        companyId: args.companyId,
        createdBy: args.actorId
      }))
    )
    .execute();
}

/**
 * Atomically create the reimbursement invoice Draft and its idempotency anchor.
 * A retry returns the mapped row. It may adopt the pre-transaction writer's
 * unique system reference; an incomplete legacy Draft is repaired in the same
 * transaction before it is mapped.
 */
export async function stageOrResumeRampReimbursementInvoice(
  db: Kysely<KyselyDatabase>,
  args: RampReimbursementInvoiceDraft
): Promise<StagedRampReimbursementInvoice> {
  return db.transaction().execute(async (tx) => {
    // Serialize the external idempotency key itself. The mapping's uniqueness
    // constraint is checked only at the final write; without this lock, two
    // workers could both miss it and create separate invoice structures first.
    await sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          ${`ramp:reimbursement:${args.companyId}:${args.reimbursementRemoteId}`},
          0
        )
      )
    `.execute(tx);
    const mapping = createMappingService(tx, args.companyId);
    const mapped = await mapping.getByExternalId(
      "ramp",
      args.reimbursementRemoteId,
      "bill"
    );
    let existing = mapped?.entityId
      ? await tx
          .selectFrom("purchaseInvoice")
          .select(["id", "invoiceId", "status", "currencyCode", "exchangeRate"])
          .where("id", "=", mapped.entityId)
          .where("companyId", "=", args.companyId)
          .executeTakeFirst()
      : undefined;
    if (mapped && !existing) {
      throw new Error("Mapped reimbursement invoice no longer exists");
    }

    if (!existing) {
      const legacy = await tx
        .selectFrom("purchaseInvoice")
        .select(["id", "invoiceId", "status", "currencyCode", "exchangeRate"])
        .where("companyId", "=", args.companyId)
        .where("supplierId", "=", args.supplierId)
        .where("supplierReference", "=", args.supplierReference)
        .limit(2)
        .execute();
      if (legacy.length > 1) {
        throw new Error("Ambiguous untracked Ramp reimbursement invoice");
      }
      existing = legacy[0];
      if (
        existing &&
        (existing.status === "Draft" || existing.status === "Pending")
      ) {
        if (existing.currencyCode !== args.currencyCode) {
          throw new Error(
            `Untracked Ramp reimbursement invoice currency ${existing.currencyCode} does not match ${args.currencyCode}`
          );
        }
        await repairLegacyDraft(
          tx,
          { ...args, exchangeRate: existing.exchangeRate },
          existing.id
        );
      }
      if (existing) {
        await mapping.link(
          "bill",
          existing.id,
          "ramp",
          args.reimbursementRemoteId,
          { createdBy: args.actorId }
        );
      }
    }

    if (existing) {
      return {
        invoiceRowId: existing.id,
        readableInvoiceId: existing.invoiceId,
        status: existing.status,
        currencyCode: existing.currencyCode,
        exchangeRate: existing.exchangeRate,
        created: false
      };
    }

    const interaction = await tx
      .insertInto("supplierInteraction")
      .values({ companyId: args.companyId, supplierId: args.supplierId })
      .returning("id")
      .executeTakeFirstOrThrow();
    const sequence = await sql<{ get_next_sequence: string }>`
      SELECT get_next_sequence('purchaseInvoice', ${args.companyId}) as get_next_sequence
    `.execute(tx);
    const readableInvoiceId =
      sequence.rows[0]?.get_next_sequence ??
      `RAMP-${args.reimbursementRemoteId.slice(0, 8)}`;
    const invoice = await tx
      .insertInto("purchaseInvoice")
      .values({
        invoiceId: readableInvoiceId,
        status: "Draft",
        supplierId: args.supplierId,
        supplierReference: args.supplierReference,
        currencyCode: args.currencyCode,
        exchangeRate: args.exchangeRate,
        dateIssued: args.dateIssued,
        dateDue: args.dateDue,
        supplierInteractionId: interaction.id,
        companyId: args.companyId,
        createdBy: args.actorId
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await tx
      .insertInto("purchaseInvoiceDelivery")
      .values({
        id: invoice.id,
        companyId: args.companyId,
        supplierShippingCost: 0
      })
      .execute();
    await insertInvoiceLines(tx, args, invoice.id);
    await mapping.link("bill", invoice.id, "ramp", args.reimbursementRemoteId, {
      createdBy: args.actorId
    });
    return {
      invoiceRowId: invoice.id,
      readableInvoiceId,
      status: "Draft",
      currencyCode: args.currencyCode,
      exchangeRate: args.exchangeRate,
      created: true
    };
  });
}

export function reimbursementPaymentExternalId(
  reimbursementId: string
): string {
  return `reimbursement-payment:${reimbursementId}`;
}

export function shouldConfirmReimbursement(args: {
  invoicePosted: boolean;
  rampPaid: boolean;
  paymentStatus: PaymentStatus | null;
}): boolean {
  return (
    args.invoicePosted && (!args.rampPaid || args.paymentStatus === "Posted")
  );
}

function extractRampUser(reimbursement: RampReimbursement): {
  user_id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
} | null {
  const user = reimbursement.user as
    | {
        id?: string;
        user_id?: string;
        first_name?: string | null;
        last_name?: string | null;
        email?: string | null;
      }
    | null
    | undefined;
  const userId = user?.user_id ?? user?.id ?? reimbursement.user_id ?? null;
  if (!userId) return null;
  return {
    user_id: userId,
    first_name: user?.first_name ?? null,
    last_name: user?.last_name ?? null,
    email: user?.email ?? null
  };
}

async function buildReimbursementLines(
  deps: RampReimbursementDependencies,
  reimbursement: RampReimbursement,
  currencyCode: string
): Promise<{ lines: RampReimbursementInvoiceLine[] } | { error: string }> {
  await deps.getDecimals(currencyCode);
  const items = reimbursement.line_items ?? [];
  if (items.length === 0) {
    return { error: "Reimbursement has no line items to post" };
  }

  const uncoded =
    "Reimbursement line is coded to an account Carbon doesn't recognize — recode it in Ramp";
  const lines: RampReimbursementInvoiceLine[] = [];
  for (const item of items) {
    const { accountId, costCenterId } = codeSelections(
      item.accounting_field_selections
    );
    if (!accountId) return { error: uncoded };
    const normalized = await deps.normalizeAmount(
      item.amount,
      currencyCode,
      "Reimbursement line amount"
    );
    if (!normalized.ok) return { error: normalized.error };
    lines.push({
      accountId,
      costCenterId,
      amount: Math.abs(normalized.value),
      description: item.memo ?? null
    });
  }

  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  let accountQuery = deps.client
    .from("account")
    .select("id")
    .in("id", accountIds);
  if (deps.companyGroupId) {
    accountQuery = accountQuery.eq("companyGroupId", deps.companyGroupId);
  }
  const accounts = await accountQuery;
  if (accounts.error) {
    return { error: `Failed to verify accounts: ${accounts.error.message}` };
  }
  const knownAccounts = new Set((accounts.data ?? []).map((row) => row.id));
  if (accountIds.some((id) => !knownAccounts.has(id))) {
    return { error: uncoded };
  }

  const costCenterIds = [
    ...new Set(
      lines
        .map((line) => line.costCenterId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  if (costCenterIds.length > 0) {
    const costCenters = await deps.client
      .from("costCenter")
      .select("id")
      .in("id", costCenterIds)
      .eq("companyId", deps.companyId);
    if (costCenters.error) {
      return {
        error: `Failed to verify cost centers: ${costCenters.error.message}`
      };
    }
    const knownCostCenters = new Set(
      (costCenters.data ?? []).map((row) => row.id)
    );
    if (costCenterIds.some((id) => !knownCostCenters.has(id))) {
      return {
        error:
          "Line is coded to a cost center Carbon doesn't recognize — recode it in Ramp"
      };
    }
  }

  return { lines };
}

async function finishRampReimbursement(
  deps: RampReimbursementDependencies,
  reimbursement: RampReimbursement,
  invoice: StagedRampReimbursementInvoice,
  isRampPaid: boolean,
  paymentAmount: number | null
): Promise<{ ok: SyncItem } | { fail: FailItem }> {
  const observedInvoice = await deps.client
    .from("purchaseInvoice")
    .select("status")
    .eq("id", invoice.invoiceRowId)
    .eq("companyId", deps.companyId)
    .maybeSingle();
  if (observedInvoice.error) {
    return {
      fail: { id: reimbursement.id, message: observedInvoice.error.message }
    };
  }
  const invoicePosted =
    observedInvoice.data?.status !== undefined &&
    !["Draft", "Pending", "Voided"].includes(observedInvoice.data.status);
  if (!invoicePosted) {
    return {
      fail: {
        id: reimbursement.id,
        message: "Reimbursement invoice is not observably posted in Carbon"
      }
    };
  }

  let paymentStatus: PaymentStatus | null = null;
  if (isRampPaid) {
    const bankAccount =
      deps.reimbursementBankAccountId ?? deps.statementBankAccountId;
    const paymentDate = (
      reimbursement.approved_at ?? reimbursement.transaction_date
    )?.slice(0, 10);
    if (!bankAccount) {
      return {
        fail: {
          id: reimbursement.id,
          message:
            "Ramp-paid reimbursement requires a reimbursement or statement bank account"
        }
      };
    }
    if (paymentAmount === null || paymentAmount <= 0 || !paymentDate) {
      return {
        fail: {
          id: reimbursement.id,
          message:
            "Ramp-paid reimbursement requires a positive verified amount and payment date"
        }
      };
    }

    const paymentExternalId = reimbursementPaymentExternalId(reimbursement.id);
    try {
      const paymentExchangeRate = await deps.getExchangeRate(
        invoice.currencyCode
      );
      await createOrResumeRampPayment(deps.db, deps.client, {
        companyId: deps.companyId,
        actorId: deps.actorId,
        bankAccount,
        paymentMappingId: paymentExternalId,
        legacyMemo: `Ramp reimbursement ${reimbursement.id}`,
        normalized: {
          family: "ap",
          documentRemoteId: reimbursement.id,
          paymentRemoteId: paymentExternalId,
          amount: paymentAmount,
          currencyCode: invoice.currencyCode,
          exchangeRate: paymentExchangeRate,
          paidDate: paymentDate,
          reference: paymentExternalId,
          status: "settled"
        }
      });
      paymentStatus = "Posted";
    } catch (error) {
      return {
        fail: {
          id: reimbursement.id,
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  if (
    !shouldConfirmReimbursement({
      invoicePosted,
      rampPaid: isRampPaid,
      paymentStatus
    })
  ) {
    return {
      fail: {
        id: reimbursement.id,
        message: "Reimbursement is not fully posted in Carbon"
      }
    };
  }
  return {
    ok: {
      id: reimbursement.id,
      referenceId: invoice.readableInvoiceId,
      deepLinkUrl: deps.invoiceDeepLinkUrl(invoice.invoiceRowId)
    }
  };
}

/** Atomically stage/resume, post, and if needed settle one reimbursement. */
export async function syncRampReimbursement(
  deps: RampReimbursementDependencies,
  reimbursement: RampReimbursement
): Promise<{ ok: SyncItem } | { fail: FailItem }> {
  const state = reimbursement.state ?? "";
  const isRampPaid = REIMBURSEMENT_PAID_STATES.has(state);
  if (!isRampPaid && !REIMBURSEMENT_INVOICE_ONLY_STATES.has(state)) {
    return {
      fail: {
        id: reimbursement.id,
        message: `Unsupported Ramp reimbursement state: ${state || "missing"}`
      }
    };
  }
  const mapping = createMappingService(deps.db, deps.companyId);
  const mappedInvoiceId = await mapping.getEntityId(
    "ramp",
    reimbursement.id,
    "bill"
  );

  let staged: StagedRampReimbursementInvoice;
  let paymentAmount: number | null = null;
  if (mappedInvoiceId) {
    const existing = await deps.client
      .from("purchaseInvoice")
      .select("id, invoiceId, status, currencyCode, exchangeRate")
      .eq("id", mappedInvoiceId)
      .eq("companyId", deps.companyId)
      .maybeSingle();
    if (existing.error) {
      return {
        fail: { id: reimbursement.id, message: existing.error.message }
      };
    }
    if (!existing.data?.currencyCode) {
      return {
        fail: {
          id: reimbursement.id,
          message: "Mapped reimbursement invoice is missing or has no currency"
        }
      };
    }
    if (existing.data.exchangeRate === null) {
      return {
        fail: {
          id: reimbursement.id,
          message:
            "Mapped reimbursement invoice has no authoritative exchange-rate snapshot"
        }
      };
    }
    staged = {
      invoiceRowId: existing.data.id,
      readableInvoiceId: existing.data.invoiceId,
      status: existing.data.status,
      currencyCode: existing.data.currencyCode,
      exchangeRate: existing.data.exchangeRate,
      created: false
    };
    if (isRampPaid) {
      const normalized = await deps.normalizeAmount(
        reimbursement.amount,
        staged.currencyCode,
        "Reimbursement payment amount"
      );
      if (!normalized.ok) {
        return { fail: { id: reimbursement.id, message: normalized.error } };
      }
      paymentAmount = Math.abs(normalized.value);
    }
  } else {
    const rampUser = extractRampUser(reimbursement);
    if (!rampUser) {
      return {
        fail: {
          id: reimbursement.id,
          message:
            "Reimbursement has no user — cannot resolve an employee supplier"
        }
      };
    }

    let supplierId: string;
    let currencyCode: string;
    let exchangeRate: number;
    let lines: RampReimbursementInvoiceLine[];
    try {
      supplierId = await resolveEmployeeSupplier(
        deps.client,
        deps.db,
        deps.companyId,
        rampUser
      );
      currencyCode = reimbursement.currency_code ?? deps.baseCurrency;
      exchangeRate = await deps.getExchangeRate(currencyCode);
      const built = await buildReimbursementLines(
        deps,
        reimbursement,
        currencyCode
      );
      if ("error" in built) {
        return { fail: { id: reimbursement.id, message: built.error } };
      }
      lines = built.lines;
    } catch (error) {
      return {
        fail: {
          id: reimbursement.id,
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }

    if (isRampPaid) {
      const normalized = await deps.normalizeAmount(
        reimbursement.amount,
        currencyCode,
        "Reimbursement payment amount"
      );
      if (!normalized.ok) {
        return { fail: { id: reimbursement.id, message: normalized.error } };
      }
      paymentAmount = Math.abs(normalized.value);
    }

    try {
      staged = await stageOrResumeRampReimbursementInvoice(deps.db, {
        companyId: deps.companyId,
        actorId: deps.actorId,
        reimbursementRemoteId: reimbursement.id,
        supplierId,
        supplierReference: `RAMP-REIMB-${reimbursement.id}`,
        currencyCode,
        exchangeRate,
        dateIssued: reimbursement.transaction_date?.slice(0, 10) ?? null,
        dateDue: reimbursement.approved_at?.slice(0, 10) ?? null,
        lines
      });
    } catch (error) {
      return {
        fail: {
          id: reimbursement.id,
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  if (staged.status === "Draft" || staged.status === "Pending") {
    const posted = await deps.postInvoice(staged.invoiceRowId);
    if ("fail" in posted) {
      return { fail: { id: reimbursement.id, message: posted.fail } };
    }
    staged = { ...staged, readableInvoiceId: posted.readableId };
  }
  return finishRampReimbursement(
    deps,
    reimbursement,
    staged,
    isRampPaid,
    paymentAmount
  );
}
