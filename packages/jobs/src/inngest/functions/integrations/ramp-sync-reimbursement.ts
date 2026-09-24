import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { createMappingService } from "@carbon/ee/accounting";
import {
  codeSelections,
  type RampReimbursement,
  scaleLinesToTotal
} from "@carbon/ee/ramp.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Kysely, sql } from "kysely";

type ReimbursementStatus = Database["public"]["Enums"]["reimbursementStatus"];

/**
 * The `externalIntegrationMapping` entity type a Ramp reimbursement is keyed
 * by. It is NOT `"bill"` any more: the document is a `reimbursement` row, not a
 * purchase invoice, and the ERP's reimbursement detail loader reads this exact
 * value to render the SOURCE badge's external id. The two must stay in step.
 */
export const RAMP_REIMBURSEMENT_ENTITY_TYPE = "reimbursement";

export type RampReimbursementLine = {
  accountId: string;
  costCenterId: string | null;
  projectId: string | null;
  amount: number;
  description: string | null;
};

/**
 * Ramp already paid the employee, but the document lands **Draft** and a Draft
 * cannot be settled — so the payout is recorded as an INTENT on the Ramp
 * mapping's metadata and turned into a `payment` + `invoiceSettlement` by the
 * ERP's Post helper (`apps/erp/app/modules/invoicing/reimbursement.server.ts`).
 *
 * These keys are the wire contract with that helper, so they are written at the
 * TOP LEVEL of the mapping metadata rather than nested. `exchangeRate` is the
 * rate resolved at IMPORT: the payout has to post at the rate Ramp used, so the
 * Post helper must spend this snapshot and never re-derive a rate of its own.
 */
export type RampReimbursementPayout = {
  rampPaymentId: string;
  paidAt: string;
  bankAccountId: string;
  amount: number;
  currencyCode: string;
  exchangeRate: number;
};

/**
 * Has a payout intent already been recorded on this mapping's metadata?
 *
 * Keyed on `rampPaymentId` because that is the field the Post helper cannot
 * work without — a metadata bag carrying only the receipt/deep-link keys is
 * NOT a recorded payout. Lives next to `RampReimbursementPayout` so the
 * predicate and the wire contract cannot drift apart.
 */
export function hasRecordedPayout(metadata: unknown): boolean {
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    typeof (metadata as Record<string, unknown>).rampPaymentId === "string"
  );
}

export type RampReimbursementDraft = {
  companyId: string;
  actorId: string;
  reimbursementRemoteId: string;
  employeeId: string;
  reference: string;
  currencyCode: string;
  exchangeRate: number;
  amount: number;
  reimbursementDate: string;
  postingDate: string | null;
  lines: RampReimbursementLine[];
  payout: RampReimbursementPayout | null;
};

export type CreatedRampReimbursement = {
  reimbursementRowId: string;
  readableId: string;
  status: ReimbursementStatus;
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
  reimbursementDeepLinkUrl: (reimbursementRowId: string) => string;
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

/**
 * Atomically create the Draft `reimbursement`, its coding lines, and the Ramp
 * mapping that is its idempotency anchor.
 *
 * It **creates, and never updates.** "Provider owns it until it lands; Carbon
 * owns it after" — an imported spend document is editable in Carbon while it is
 * Draft, so a later sweep that refreshed the header and replaced the lines (as
 * the charge stager still does, and as this function's purchase-invoice
 * ancestor did) would silently destroy a reviewer's coding with no error and no
 * way to tell it happened. The accepted cost, stated in
 * `.ai/specs/2026-09-23-editable-imported-spend-documents.md`: a provider-side
 * correction made AFTER import does not flow through — the reviewer sees what
 * originally arrived and can re-edit it.
 *
 * The advisory lock prevents two workers from creating different local rows
 * before the mapping's uniqueness constraint is reached.
 */
export async function createRampReimbursement(
  db: Kysely<KyselyDatabase>,
  args: RampReimbursementDraft
): Promise<CreatedRampReimbursement> {
  return db.transaction().execute(async (tx) => {
    // Serialize the external idempotency key itself. The mapping's uniqueness
    // constraint is checked only at the final write; without this lock, two
    // workers could both miss it and create separate documents first.
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
      RAMP_REIMBURSEMENT_ENTITY_TYPE
    );
    if (mapped) {
      const existing = await tx
        .selectFrom("reimbursement")
        .select(["id", "reimbursementId", "status"])
        .where("id", "=", mapped.entityId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (!existing) {
        throw new Error("Mapped Ramp reimbursement no longer exists");
      }
      // The DOCUMENT is never refreshed: no header, no lines, no re-read of
      // Ramp's coding — see the note above.
      //
      // The mapping's payout intent is the one exception, and it is not a
      // document re-write. "Never re-write" exists to protect a reviewer's
      // edits; nobody edits mapping bookkeeping. Without this, a reimbursement
      // imported while APPROVED that Ramp later PAYS and re-lists would keep a
      // payout-less mapping forever, so Post would never create the
      // `payment`/`invoiceSettlement` — money moves in Ramp and Carbon never
      // settles it.
      //
      // Strictly additive: an intent already on the mapping is authoritative
      // (it carries the FX snapshot of the payout that actually happened) and
      // is never overwritten by a later pass.
      if (args.payout && !hasRecordedPayout(mapped.metadata)) {
        await tx
          .updateTable("externalIntegrationMapping")
          .set({
            metadata: sql`coalesce("metadata", '{}'::jsonb) || ${JSON.stringify(
              args.payout
            )}::jsonb`
          })
          .where("id", "=", mapped.id)
          .where("companyId", "=", args.companyId)
          .execute();
      }
      return {
        reimbursementRowId: existing.id,
        readableId: existing.reimbursementId,
        status: existing.status,
        created: false
      };
    }

    if (args.lines.length === 0) {
      throw new Error("Ramp reimbursement requires at least one coded line");
    }

    const sequence = await sql<{ get_next_sequence: string }>`
      SELECT get_next_sequence('reimbursement', ${args.companyId}) as get_next_sequence
    `.execute(tx);
    const readableId =
      sequence.rows[0]?.get_next_sequence ??
      `RAMP-${args.reimbursementRemoteId.slice(0, 8)}`;

    const header = await tx
      .insertInto("reimbursement")
      .values({
        reimbursementId: readableId,
        companyId: args.companyId,
        employeeId: args.employeeId,
        status: "Draft",
        integration: "ramp",
        reimbursementDate: args.reimbursementDate,
        postingDate: args.postingDate,
        currencyCode: args.currencyCode,
        exchangeRate: args.exchangeRate,
        amount: args.amount,
        reference: args.reference,
        createdBy: args.actorId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    // 0-based `sequence`, the `chargeLine` convention — and the order
    // `post-reimbursement` reads the lines back in.
    await tx
      .insertInto("reimbursementLine")
      .values(
        args.lines.map((line, index) => ({
          reimbursementId: header.id,
          companyId: args.companyId,
          accountId: line.accountId,
          costCenterId: line.costCenterId,
          projectId: line.projectId,
          description: line.description,
          amount: line.amount,
          sequence: index,
          createdBy: args.actorId
        }))
      )
      .execute();

    await mapping.link(
      RAMP_REIMBURSEMENT_ENTITY_TYPE,
      header.id,
      "ramp",
      args.reimbursementRemoteId,
      {
        createdBy: args.actorId,
        metadata: args.payout ? { ...args.payout } : undefined
      }
    );

    return {
      reimbursementRowId: header.id,
      readableId,
      status: "Draft",
      created: true
    };
  });
}

export function reimbursementPaymentExternalId(
  reimbursementId: string
): string {
  return `reimbursement-payment:${reimbursementId}`;
}

/**
 * Build the deferred payout intent for a reimbursement Ramp has already paid.
 * Pure, so the "never re-derive the rate at Post" rule is pinned by a test
 * rather than only by a comment.
 */
export function buildRampReimbursementPayout(args: {
  rampReimbursementId: string;
  bankAccountId: string | null | undefined;
  paidAt: string | null | undefined;
  amount: number | null;
  currencyCode: string;
  exchangeRate: number;
}):
  | { ok: true; value: RampReimbursementPayout }
  | { ok: false; error: string } {
  if (!args.bankAccountId) {
    return {
      ok: false,
      error:
        "Ramp-paid reimbursement requires a reimbursement or statement bank account"
    };
  }
  const paidAt = args.paidAt?.slice(0, 10);
  if (
    args.amount === null ||
    !Number.isFinite(args.amount) ||
    args.amount <= 0 ||
    !paidAt
  ) {
    return {
      ok: false,
      error:
        "Ramp-paid reimbursement requires a positive verified amount and payment date"
    };
  }
  if (!Number.isFinite(args.exchangeRate) || args.exchangeRate <= 0) {
    return {
      ok: false,
      error: "Ramp-paid reimbursement has no usable exchange-rate snapshot"
    };
  }
  return {
    ok: true,
    value: {
      rampPaymentId: reimbursementPaymentExternalId(args.rampReimbursementId),
      paidAt,
      bankAccountId: args.bankAccountId,
      amount: args.amount,
      currencyCode: args.currencyCode,
      exchangeRate: args.exchangeRate
    }
  };
}

/**
 * The header amount, in the verified minor-unit shape the normalizer requires.
 *
 * A live reimbursement's top-level `amount` is a bare number in MAJOR units —
 * the same deprecated field the card path already learned not to read
 * (`.claude/rules/ramp-integration.md`, live-verified 2026-08-28). Handing it
 * to `normalizeVerifiedMinorAmount` rejected EVERY reimbursement with
 * "ambiguous bare-number amount", so nothing could ever import.
 *
 * `entity_amount` first, for the same reason the charge header uses it: it is
 * what the entity settles, in the entity's own currency. `payee_amount` (what
 * the employee receives) and `original_reimbursement_amount` (what they
 * submitted) follow. The bare `amount` is deliberately NOT a fallback — a
 * number whose units cannot be verified must fail loudly rather than post a
 * document that is wrong by 100×.
 */
export function reimbursementHeaderAmount(
  reimbursement: RampReimbursement
): unknown {
  return (
    reimbursement.entity_amount ??
    reimbursement.payee_amount ??
    reimbursement.original_reimbursement_amount ??
    reimbursement.amount
  );
}

export function extractRampUser(reimbursement: RampReimbursement): {
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
  // Prefer the nested `user` object, then Ramp's TOP-LEVEL `user_email` /
  // `user_full_name`. Real Ramp reimbursements carry the identity at the top
  // level and send `user: null`, so reading only the nested object found no
  // email and every import failed "cannot match a Carbon employee" — with the
  // address sitting in the payload the whole time.
  const fullName = reimbursement.user_full_name ?? null;
  const [derivedFirst, ...derivedRest] = (fullName ?? "").trim().split(/\s+/);
  return {
    user_id: userId,
    first_name: user?.first_name ?? (derivedFirst || null),
    last_name: user?.last_name ?? (derivedRest.join(" ") || null),
    email: user?.email ?? reimbursement.user_email ?? null
  };
}

/**
 * Resolve the Ramp user to a Carbon **employee** — `employee.id` IS the user id
 * (`.claude/rules/user-employee-job-relationships.md`), so the join is
 * `user.email` → `user.id` → `employee(id, companyId)`.
 *
 * Never auto-creates anything. The old path auto-created a synthetic "Employee"
 * supplier, which is the vendor-master pollution this document exists to end;
 * an unknown employee is a real gap a human has to close in Carbon, so it fails
 * the item visibly instead.
 */
async function resolveReimbursementEmployee(
  deps: RampReimbursementDependencies,
  rampUser: { email?: string | null }
): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  const email = rampUser.email?.trim().toLowerCase();
  if (!email) {
    return {
      ok: false,
      error:
        "Reimbursement's Ramp user has no email — cannot match a Carbon employee"
    };
  }
  const users = await deps.client.from("user").select("id").eq("email", email);
  if (users.error) {
    return {
      ok: false,
      error: `Failed to resolve the reimbursement's employee: ${users.error.message}`
    };
  }
  const userIds = (users.data ?? []).map((row) => row.id);
  const notAnEmployee = `Reimbursement has no matching Carbon employee — invite ${email} as an employee, then retry`;
  if (userIds.length === 0) return { ok: false, error: notAnEmployee };

  const employees = await deps.client
    .from("employee")
    .select("id")
    .eq("companyId", deps.companyId)
    .in("id", userIds);
  if (employees.error) {
    return {
      ok: false,
      error: `Failed to resolve the reimbursement's employee: ${employees.error.message}`
    };
  }
  const matches = employees.data ?? [];
  if (matches.length === 0) return { ok: false, error: notAnEmployee };
  if (matches.length > 1) {
    return {
      ok: false,
      error: `Reimbursement matches more than one Carbon employee for ${email} — resolve the duplicate, then retry`
    };
  }
  return { ok: true, value: matches[0]!.id };
}

async function buildReimbursementLines(
  deps: RampReimbursementDependencies,
  reimbursement: RampReimbursement,
  currencyCode: string,
  headerAmount: number
): Promise<{ lines: RampReimbursementLine[] } | { error: string }> {
  const decimals = await deps.getDecimals(currencyCode);
  const items = reimbursement.line_items ?? [];
  if (items.length === 0) {
    return { error: "Reimbursement has no line items to post" };
  }

  const uncoded =
    "Reimbursement line is coded to an account Carbon doesn't recognize — recode it in Ramp";
  const lines: RampReimbursementLine[] = [];
  for (const item of items) {
    const { accountId, costCenterId, projectId } = codeSelections(
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
      projectId,
      amount: Math.abs(normalized.value),
      description: item.memo ?? null
    });
  }

  // Scale the coding lines onto the header amount, exactly as the card path
  // does (`ramp-sync-card.ts`). `post-reimbursement`'s `requireLineSum` refuses
  // a header/line mismatch outright, and under the Draft model an unbalanced
  // import would sit in the review queue blocking Post with no obvious cause.
  // Same-currency input is a no-op (ratio 1, residual 0).
  let settledLines: RampReimbursementLine[];
  try {
    settledLines = scaleLinesToTotal(lines, headerAmount, decimals);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  // `requireLineSum` also rejects a non-positive coding line, so a Draft
  // carrying one could never be posted. Fail the import instead of queueing it.
  if (
    settledLines.some(
      (line) => !Number.isFinite(line.amount) || line.amount <= 0
    )
  ) {
    return {
      error:
        "Reimbursement coding line amounts must be finite and greater than zero"
    };
  }

  const accountIds = [...new Set(settledLines.map((line) => line.accountId))];
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
      settledLines
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

  const projectIds = [
    ...new Set(
      settledLines
        .map((line) => line.projectId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  if (projectIds.length > 0) {
    const projects = await deps.client
      .from("project")
      .select("id")
      .in("id", projectIds)
      .eq("companyId", deps.companyId);
    if (projects.error) {
      return {
        error: `Failed to verify projects: ${projects.error.message}`
      };
    }
    const knownProjects = new Set((projects.data ?? []).map((row) => row.id));
    if (projectIds.some((id) => !knownProjects.has(id))) {
      return {
        error:
          "Line is coded to a project Carbon doesn't recognize — recode it in Ramp"
      };
    }
  }

  return { lines: settledLines };
}

/**
 * Confirm to Ramp only once the write is observably durable — a tenant-scoped
 * reread on the ordinary (non-transaction) client, so an ambiguous staging
 * outcome cannot be reported as synced.
 */
async function observeRampReimbursement(
  deps: RampReimbursementDependencies,
  reimbursement: RampReimbursement,
  reimbursementRowId: string
): Promise<{ ok: SyncItem } | { fail: FailItem }> {
  const observed = await deps.client
    .from("reimbursement")
    .select("id, reimbursementId")
    .eq("id", reimbursementRowId)
    .eq("companyId", deps.companyId)
    .maybeSingle();
  if (observed.error) {
    return { fail: { id: reimbursement.id, message: observed.error.message } };
  }
  if (!observed.data) {
    return {
      fail: {
        id: reimbursement.id,
        message: "Reimbursement is not observably durable in Carbon"
      }
    };
  }
  return {
    ok: {
      id: reimbursement.id,
      referenceId: observed.data.reimbursementId,
      deepLinkUrl: deps.reimbursementDeepLinkUrl(observed.data.id)
    }
  };
}

/**
 * Import one Ramp reimbursement as a **Draft** `reimbursement`.
 *
 * It never posts. Draft is the review queue: the editable window exists so a
 * human can correct the CODING before it reaches the GL. Whether Ramp already
 * paid the employee is a settled fact about the outside world and a different
 * question entirely, so the two are decoupled — Ramp is confirmed at import
 * (its "synced" means the ERP has the record, which it does), and an
 * already-paid reimbursement's payout rides the mapping metadata until the
 * document is Posted, when the ERP's Post helper records it.
 */
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
  const mappedId = await mapping.getEntityId(
    "ramp",
    reimbursement.id,
    RAMP_REIMBURSEMENT_ENTITY_TYPE
  );
  if (mappedId) {
    // Already imported. Carbon owns the document now — re-confirm only.
    return observeRampReimbursement(deps, reimbursement, mappedId);
  }

  const reimbursementDate = reimbursement.transaction_date?.slice(0, 10);
  if (!reimbursementDate) {
    return {
      fail: {
        id: reimbursement.id,
        message: "Reimbursement has no transaction date"
      }
    };
  }

  const rampUser = extractRampUser(reimbursement);
  if (!rampUser) {
    return {
      fail: {
        id: reimbursement.id,
        message: "Reimbursement has no user — cannot resolve a Carbon employee"
      }
    };
  }
  const employee = await resolveReimbursementEmployee(deps, rampUser);
  if (!employee.ok) {
    return { fail: { id: reimbursement.id, message: employee.error } };
  }

  const currencyCode =
    reimbursement.entity_amount?.currency ??
    reimbursement.currency_code ??
    reimbursement.currency ??
    deps.baseCurrency;
  const normalizedAmount = await deps.normalizeAmount(
    reimbursementHeaderAmount(reimbursement),
    currencyCode,
    "Reimbursement amount"
  );
  if (!normalizedAmount.ok) {
    return { fail: { id: reimbursement.id, message: normalizedAmount.error } };
  }
  const amount = Math.abs(normalizedAmount.value);
  if (!(amount > 0)) {
    return {
      fail: {
        id: reimbursement.id,
        message: "Reimbursement amount must be greater than zero"
      }
    };
  }

  let exchangeRate: number;
  let lines: RampReimbursementLine[];
  try {
    exchangeRate = await deps.getExchangeRate(currencyCode);
    const built = await buildReimbursementLines(
      deps,
      reimbursement,
      currencyCode,
      amount
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

  let payout: RampReimbursementPayout | null = null;
  if (isRampPaid) {
    const built = buildRampReimbursementPayout({
      rampReimbursementId: reimbursement.id,
      bankAccountId:
        deps.reimbursementBankAccountId ?? deps.statementBankAccountId,
      paidAt: reimbursement.approved_at ?? reimbursement.transaction_date,
      amount,
      currencyCode,
      exchangeRate
    });
    if (!built.ok) {
      return { fail: { id: reimbursement.id, message: built.error } };
    }
    payout = built.value;
  }

  let created: CreatedRampReimbursement;
  try {
    created = await createRampReimbursement(deps.db, {
      companyId: deps.companyId,
      actorId: deps.actorId,
      reimbursementRemoteId: reimbursement.id,
      employeeId: employee.value,
      reference: `RAMP-REIMB-${reimbursement.id}`,
      currencyCode,
      exchangeRate,
      amount,
      reimbursementDate,
      // Ramp's approval is when the expense became payable; posting resolves
      // the accounting period from it (falling back to `reimbursementDate`).
      postingDate: reimbursement.approved_at?.slice(0, 10) ?? null,
      lines,
      payout
    });
  } catch (error) {
    return {
      fail: {
        id: reimbursement.id,
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }

  return observeRampReimbursement(
    deps,
    reimbursement,
    created.reimbursementRowId
  );
}
