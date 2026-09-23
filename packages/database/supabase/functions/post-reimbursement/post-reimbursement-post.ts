import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import type { Selectable, Transaction } from "kysely";
import type { DB } from "../lib/database.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import { resolveAccountingPeriod } from "../shared/get-accounting-period.ts";
import {
  buildReimbursementJournal,
  type GLAccountClass,
} from "./build-reimbursement-journal.ts";
// Already generic — allocating journal-line ids has nothing charge-specific
// about it, so this is imported rather than copied.
import { allocateJournalLineIds } from "../post-charge/journal-line-ids.ts";

export type ReimbursementContext = {
  trx: Transaction<DB>;
  reimbursement: Pick<
    Selectable<DB["reimbursement"]>,
    | "id"
    | "reimbursementId"
    | "employeeId"
    | "status"
    | "amount"
    | "currencyCode"
    | "exchangeRate"
    | "payableAccountId"
    | "reimbursementDate"
    | "postingDate"
    | "journalId"
  >;
  company: Pick<
    Selectable<DB["company"]>,
    "companyGroupId" | "baseCurrencyCode" | "timezone"
  >;
  accountingEnabled: boolean;
  companyId: string;
  userId: string;
  timestamp: string;
  today: string;
};

function isAccountClass(value: string | null): value is GLAccountClass {
  return value === "Asset" || value === "Liability" || value === "Equity" ||
    value === "Revenue" || value === "Expense";
}

export async function postReimbursement(
  context: ReimbursementContext,
): Promise<{ journalId: string | null }> {
  const {
    trx,
    reimbursement,
    company,
    accountingEnabled,
    companyId,
    userId,
    timestamp,
  } = context;
  // The parent lock serializes line writes. Locking line tuples too would
  // deadlock with an UPDATE whose BEFORE trigger is waiting for that parent.
  const lines = await trx.selectFrom("reimbursementLine").selectAll()
    .where("reimbursementId", "=", reimbursement.id)
    .where("companyId", "=", companyId)
    .orderBy("sequence")
    .orderBy("id")
    .execute();

  // Resolve the employee-payable control account by ID from `accountDefault` —
  // never by account number or name, which are user-editable at any time
  // (lessons.md: "Never resolve a control account by number/name"). The
  // `employeeReimbursementsPayableAccount` column is nullable by design: an
  // upgrading company that has never configured it must still be able to post,
  // so the AP trade account is the documented fallback.
  const defaults = await trx.selectFrom("accountDefault")
    .select(["employeeReimbursementsPayableAccount", "payablesAccount"])
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  const payableAccountId = reimbursement.payableAccountId ??
    defaults?.employeeReimbursementsPayableAccount ??
    defaults?.payablesAccount ??
    null;
  if (!payableAccountId) {
    throw new Error(
      "No employee reimbursements payable account and no payables account is configured",
    );
  }

  const accountIds = [
    ...new Set([
      payableAccountId,
      ...lines.map((line) => line.accountId),
    ]),
  ];
  const postingAccounts = await trx.selectFrom("account").select([
    "id",
    "class",
  ]).where("id", "in", accountIds)
    .where("companyGroupId", "=", company.companyGroupId)
    .where("active", "=", true)
    .where("isGroup", "=", false)
    .execute();
  if (
    postingAccounts.length !== accountIds.length ||
    postingAccounts.some((account) => !isAccountClass(account.class))
  ) {
    throw new Error(
      "Reimbursement accounts must be active posting accounts in this company group",
    );
  }
  const accounts: Record<string, { class: GLAccountClass }> = {};
  for (const account of postingAccounts) {
    if (!isAccountClass(account.class)) {
      throw new Error("Reimbursement account class is missing");
    }
    accounts[account.id] = { class: account.class };
  }
  // Take the class from the RESOLVED account, so a mis-classed default (either
  // column) fails loudly instead of crediting the wrong side of the ledger.
  if (accounts[payableAccountId]?.class !== "Liability") {
    throw new Error(
      "Reimbursement payable account must be a Liability account",
    );
  }

  const costCenterIds = [
    ...new Set(
      lines.flatMap((line) => line.costCenterId ? [line.costCenterId] : []),
    ),
  ];
  if (costCenterIds.length) {
    const costCenters = await trx.selectFrom("costCenter").select("id")
      .where("companyId", "=", companyId)
      .where("id", "in", costCenterIds)
      .execute();
    if (costCenters.length !== costCenterIds.length) {
      throw new Error("Reimbursement cost center not found in this company");
    }
  }

  const projectIds = [
    ...new Set(
      lines.flatMap((line) => line.projectId ? [line.projectId] : []),
    ),
  ];
  if (projectIds.length) {
    const projects = await trx.selectFrom("project").select("id")
      .where("companyId", "=", companyId)
      .where("id", "in", projectIds)
      .execute();
    if (projects.length !== projectIds.length) {
      throw new Error("Reimbursement project not found in this company");
    }
  }

  let postingDate = reimbursement.postingDate ??
    reimbursement.reimbursementDate;
  let journalId: string | null = null;
  if (accountingEnabled) {
    const period = await resolveAccountingPeriod(
      trx,
      companyId,
      postingDate,
      "historical-with-shift",
    );
    postingDate = period.postingDate;
    const built = buildReimbursementJournal({
      reimbursement: {
        amount: Number(reimbursement.amount),
        payableAccountId,
        currencyCode: reimbursement.currencyCode,
        exchangeRate: Number(reimbursement.exchangeRate),
      },
      lines: lines.map((line) => ({
        accountId: line.accountId,
        amount: Number(line.amount),
        costCenterId: line.costCenterId,
        projectId: line.projectId,
        description: line.description,
      })),
      accounts,
      documentId: reimbursement.id,
      documentReadableId: reimbursement.reimbursementId,
    });
    // The builder emits one debit per coding line IN ORDER, then the payable
    // credit. The dimension pass below pairs `built.journalLines[i]` with
    // `lines[i]` on that contract, so assert it rather than trusting it.
    if (
      built.journalLines.length !== lines.length + 1 ||
      lines.some((line, index) =>
        built.journalLines[index]?.accountId !== line.accountId
      )
    ) {
      throw new Error("Reimbursement journal lines do not match coding lines");
    }

    const dimensions = costCenterIds.length
      ? await trx.selectFrom("dimension").select("id")
        .where("companyGroupId", "=", company.companyGroupId)
        .where("active", "=", true)
        .where("entityType", "=", "CostCenter")
        .orderBy("createdAt")
        .orderBy("id")
        .limit(1)
        .execute()
      : [];
    const costCenterDimensionId = dimensions[0]?.id ?? null;
    if (costCenterIds.length && !costCenterDimensionId) {
      throw new Error("Company group has no active Cost Center dimension");
    }
    const projectDimensions = projectIds.length
      ? await trx.selectFrom("dimension").select("id")
        .where("companyGroupId", "=", company.companyGroupId)
        .where("active", "=", true)
        .where("entityType", "=", "Project")
        .orderBy("createdAt")
        .orderBy("id")
        .limit(1)
        .execute()
      : [];
    const projectDimensionId = projectDimensions[0]?.id ?? null;
    if (projectIds.length && !projectDimensionId) {
      throw new Error("Company group has no active Project dimension");
    }

    // The generic per-line dimension rows — where a human's edit in the line
    // editor lands.
    const lineIds = lines.map((line) => line.id);
    const genericDimensions = lineIds.length
      ? await trx.selectFrom("reimbursementLineDimension").select([
        "reimbursementLineId",
        "dimensionId",
        "valueId",
      ])
        .where("companyId", "=", companyId)
        .where("reimbursementLineId", "in", lineIds)
        .orderBy("dimensionId")
        .execute()
      : [];
    const genericDimensionIds = [
      ...new Set(genericDimensions.map((row) => row.dimensionId)),
    ];
    if (genericDimensionIds.length) {
      const activeDimensions = await trx.selectFrom("dimension").select("id")
        .where("companyGroupId", "=", company.companyGroupId)
        .where("active", "=", true)
        .where("id", "in", genericDimensionIds)
        .execute();
      if (activeDimensions.length !== genericDimensionIds.length) {
        throw new Error(
          "Reimbursement line dimension is not an active dimension in this company group",
        );
      }
    }
    const genericByLineId = new Map<
      string,
      { dimensionId: string; valueId: string }[]
    >();
    for (const row of genericDimensions) {
      const existing = genericByLineId.get(row.reimbursementLineId);
      if (existing) existing.push(row);
      else genericByLineId.set(row.reimbursementLineId, [row]);
    }

    const journal = await trx.insertInto("journal").values({
      journalEntryId: await getNextSequence(trx, "journalEntry", companyId),
      accountingPeriodId: period.id,
      description: `Reimbursement ${reimbursement.reimbursementId}`,
      postingDate,
      companyId,
      sourceType: "Reimbursement",
      status: "Posted",
      postedAt: timestamp,
      postedBy: userId,
      createdBy: userId,
    }).returning("id").executeTakeFirstOrThrow();
    const createdJournalId = journal.id;
    journalId = createdJournalId;
    const journalLineReference = nanoid();
    const journalLineIds = await allocateJournalLineIds(
      trx,
      built.journalLines.length,
    );
    await trx.insertInto("journalLine").values(
      built.journalLines.map((line, index) => ({
        id: journalLineIds[index],
        journalId: createdJournalId,
        accountId: line.accountId,
        amount: line.amount,
        quantity: 1,
        description: line.description,
        documentType: "Reimbursement" as const,
        documentId: line.documentId,
        journalLineReference,
        companyId,
      })),
    ).execute();

    // Two sources feed one destination. `journalLineDimension` is UNIQUE on
    // (journalLineId, dimensionId) — one value per dimension per line — so the
    // legacy `costCenterId`/`projectId` columns and the generic
    // `reimbursementLineDimension` rows must be MERGED before the insert, not
    // written as two passes.
    //
    // When both name the same dimension, the GENERIC TABLE WINS. The two legacy
    // columns are what the Ramp SYNC wrote at import; the generic table is
    // where a HUMAN's edit in the line editor lands — and human intent beats a
    // machine default. A reader who finds that precedence surprising needs the
    // sentence here, at the call site.
    const dimensionRows: {
      journalLineId: string;
      dimensionId: string;
      valueId: string;
      companyId: string;
    }[] = [];
    built.journalLines.forEach((journalLine, index) => {
      const sourceLine = lines[index];
      // The trailing payable leg is a control account and carries no coding.
      if (!sourceLine) return;
      const journalLineId = journalLineIds[index];
      if (!journalLineId) {
        throw new Error("Failed to map reimbursement journal line");
      }
      const byDimension = new Map<string, string>();
      if (costCenterDimensionId && journalLine.costCenterId) {
        byDimension.set(costCenterDimensionId, journalLine.costCenterId);
      }
      if (projectDimensionId && journalLine.projectId) {
        byDimension.set(projectDimensionId, journalLine.projectId);
      }
      for (const row of genericByLineId.get(sourceLine.id) ?? []) {
        byDimension.set(row.dimensionId, row.valueId);
      }
      for (const [dimensionId, valueId] of byDimension) {
        dimensionRows.push({
          journalLineId,
          dimensionId,
          valueId,
          companyId,
        });
      }
    });
    if (dimensionRows.length) {
      await trx.insertInto("journalLineDimension").values(dimensionRows)
        .execute();
    }
  }

  await trx.updateTable("reimbursement").set({
    status: "Posted",
    journalId,
    postingDate,
    payableAccountId,
    postedAt: timestamp,
    postedBy: userId,
    updatedAt: timestamp,
    updatedBy: userId,
  }).where("id", "=", reimbursement.id)
    .where("companyId", "=", companyId)
    .execute();
  return { journalId };
}
