// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { datetime, equals, round } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { employeesWithPin } from "../console.server";
import { companyHasFeature } from "../plan.server";
import {
  BACKFLUSHED_ITEM_TYPES,
  materialUnitCost,
  operationScrapUnitValue,
  scrapApproverRefusal,
  sumBatchScrap
} from "./scrap";
import {
  canApproveRequest,
  getApprovalRuleByAmount,
  getApproverUserIdsForRule
} from "./service";
import type {
  ScrapApprovalPrompt,
  ScrapDescription,
  ScrapSubject
} from "./types";

const logger = getLogger("ee", "scrap-approval");

// Scrap on the shop floor posts at once (count, backflush, replacement serial,
// journal), so an approval rule is met synchronously: the approver signs on the
// tablet with their console PIN, and the request is written already Approved.
// `scrapRequest` is the document it names. Every reader and writer takes the
// service role or the server's Kysely connection: `approvalRequest` has no
// API-role policy and `scrapRequest` takes no API-role writes.

/**
 * Whether any enabled scrap approval rule could apply. The cheap first check:
 * a company without one never pays for the estimate.
 */
export async function hasScrapApprovalRules(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<boolean> {
  if (
    !(await companyHasFeature(serviceRole, companyId, {
      feature: "APPROVAL_RULES"
    }))
  ) {
    return false;
  }

  const rules = await serviceRole
    .from("approvalRule")
    .select("id")
    .eq("documentType", "scrap")
    .eq("companyId", companyId)
    .eq("enabled", true)
    .limit(1);

  // Fail closed: "no rules" would let every scrap through unapproved.
  if (rules.error) {
    logger.error("Failed to read scrap approval rules", {
      companyId,
      error: rules.error
    });
    throw new Error("Failed to read scrap approval rules");
  }

  return rules.data.length > 0;
}

async function unitCosts(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  itemIds: string[]
): Promise<Map<string, number>> {
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom("itemCost")
    .select(["itemId", "costingMethod", "unitCost", "standardCost"])
    .where("companyId", "=", companyId)
    .where("itemId", "in", ids)
    .execute();
  return new Map(
    rows.map((row) => [
      row.itemId,
      materialUnitCost({
        costingMethod: row.costingMethod,
        unitCost: row.unitCost == null ? null : Number(row.unitCost),
        standardCost: row.standardCost == null ? null : Number(row.standardCost)
      })
    ])
  );
}

const VALUATION_MATERIAL_COLUMNS = [
  "itemId",
  "quantity",
  "jobOperationId",
  "jobMakeMethodId",
  "itemType",
  "estimatedQuantity",
  "requiresBatchTracking",
  "requiresSerialTracking"
] as const;

/**
 * The material cost of one unit scrapped at each operation
 * (`operationScrapUnitValue`), read in five queries for any number of
 * operations.
 */
async function operationUnitValues(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  jobOperationIds: string[]
): Promise<
  Map<string, { jobId: string; itemId: string | null; unitValue: number }>
> {
  const operations = await db
    .selectFrom("jobOperation")
    .innerJoin(
      "jobMakeMethod",
      "jobMakeMethod.id",
      "jobOperation.jobMakeMethodId"
    )
    .select([
      "jobOperation.id",
      "jobOperation.jobId",
      "jobOperation.jobMakeMethodId",
      "jobOperation.order",
      "jobMakeMethod.itemId"
    ])
    .where("jobOperation.companyId", "=", companyId)
    .where("jobOperation.id", "in", jobOperationIds)
    .execute();
  if (operations.length === 0) return new Map();

  const makeMethodIds = [
    ...new Set(operations.map((operation) => operation.jobMakeMethodId))
  ];
  const [routing, kits] = await Promise.all([
    db
      .selectFrom("jobOperation")
      .select(["id", "jobMakeMethodId", "order"])
      .where("companyId", "=", companyId)
      .where("jobMakeMethodId", "in", makeMethodIds)
      .execute(),
    // Kitted Make to Order children: the operation backflushes their
    // materials too.
    db
      .selectFrom("jobMaterialWithMakeMethodId")
      .select(["jobOperationId", "jobMaterialMakeMethodId"])
      .where("companyId", "=", companyId)
      .where("jobOperationId", "in", jobOperationIds)
      .where("itemType", "in", BACKFLUSHED_ITEM_TYPES)
      .where("methodType", "=", "Make to Order")
      .where("kit", "=", true)
      .execute()
  ]);
  const kitMethodIds = [
    ...new Set(
      kits
        .map((kit) => kit.jobMaterialMakeMethodId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  const [materials, kitMaterials] = await Promise.all([
    db
      .selectFrom("jobMaterial")
      .select(VALUATION_MATERIAL_COLUMNS)
      .where("companyId", "=", companyId)
      .where(
        "jobOperationId",
        "in",
        routing.map((operation) => operation.id)
      )
      .where("methodType", "!=", "Make to Order")
      .execute(),
    kitMethodIds.length > 0
      ? db
          .selectFrom("jobMaterial")
          .select(VALUATION_MATERIAL_COLUMNS)
          .where("companyId", "=", companyId)
          .where("jobMakeMethodId", "in", kitMethodIds)
          .where("methodType", "!=", "Make to Order")
          .execute()
      : Promise.resolve([])
  ]);
  const costs = await unitCosts(db, companyId, [
    ...materials.map((material) => material.itemId),
    ...kitMaterials.map((material) => material.itemId)
  ]);

  const toValuation = (row: (typeof materials)[number]) => ({
    ...row,
    quantity: Number(row.quantity),
    estimatedQuantity: Number(row.estimatedQuantity)
  });
  const routingSteps = routing.map((step) => ({
    ...step,
    order: Number(step.order)
  }));

  return new Map(
    operations.map((operation) => {
      const methods = new Set(
        kits
          .filter((kit) => kit.jobOperationId === operation.id)
          .map((kit) => kit.jobMaterialMakeMethodId)
      );
      const unitValue = operationScrapUnitValue({
        operation: { ...operation, order: Number(operation.order) },
        routing: routingSteps,
        materials: materials.map(toValuation),
        kitMaterials: kitMaterials
          .filter((material) => methods.has(material.jobMakeMethodId))
          .map(toValuation),
        costs
      });
      return [
        operation.id,
        { jobId: operation.jobId, itemId: operation.itemId, unitValue }
      ];
    })
  );
}

/**
 * What a scrap would write off, before it posts: the record a
 * `scrapRequest` holds, with the estimated value an approval rule is matched
 * against. Throws when the operation, material or entity is not this company's.
 */
export async function describeScrap(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  subject: ScrapSubject
): Promise<ScrapDescription> {
  if (subject.type === "operation") {
    const values = await operationUnitValues(db, companyId, [
      subject.jobOperationId
    ]);
    const operation = values.get(subject.jobOperationId);
    if (!operation) throw new Error("Job operation not found");
    return {
      jobId: operation.jobId,
      jobOperationId: subject.jobOperationId,
      jobOperationBatchId: null,
      jobMaterialId: null,
      trackedEntityId: subject.trackedEntityId ?? null,
      itemId: operation.itemId,
      scrapReasonId: subject.scrapReasonId ?? null,
      notes: subject.notes ?? null,
      quantity: subject.quantity,
      estimatedValue: round(operation.unitValue * subject.quantity)
    };
  }

  if (subject.type === "material") {
    const [material, entity] = await Promise.all([
      db
        .selectFrom("jobMaterial")
        .select(["id", "jobId", "itemId", "jobOperationId"])
        .where("id", "=", subject.jobMaterialId)
        .where("companyId", "=", companyId)
        .executeTakeFirst(),
      db
        .selectFrom("trackedEntity")
        .select(["id", "itemId", "quantity"])
        .where("id", "=", subject.trackedEntityId)
        .where("companyId", "=", companyId)
        .executeTakeFirst()
    ]);
    if (!material) throw new Error("Job material not found");
    if (!entity) throw new Error("Tracked entity not found");

    const itemId = entity.itemId ?? material.itemId;
    const quantity = Number(entity.quantity) || 0;
    const costs = await unitCosts(db, companyId, [itemId]);
    return {
      jobId: material.jobId,
      jobOperationId: material.jobOperationId,
      jobOperationBatchId: null,
      jobMaterialId: material.id,
      trackedEntityId: entity.id,
      itemId,
      scrapReasonId: subject.scrapReasonId ?? null,
      notes: subject.notes ?? null,
      quantity,
      estimatedValue: round((costs.get(itemId) ?? 0) * quantity)
    };
  }

  const scrapped = subject.members.filter((member) => member.scrapQuantity > 0);
  const values = await operationUnitValues(
    db,
    companyId,
    scrapped.map((member) => member.jobOperationId)
  );
  if (values.size !== new Set(scrapped.map((m) => m.jobOperationId)).size) {
    throw new Error("Job operation not found");
  }
  const total = sumBatchScrap(scrapped, values);
  return {
    jobId: total.jobId,
    jobOperationId: null,
    jobOperationBatchId: subject.jobOperationBatchId,
    jobMaterialId: null,
    trackedEntityId: null,
    itemId: total.itemId,
    scrapReasonId: null,
    notes: null,
    quantity: total.quantity,
    estimatedValue: round(total.value)
  };
}

export type ScrapApprovalRequirement =
  | { required: false }
  | ({ required: true } & ScrapApprovalPrompt);

/**
 * Whether this scrap needs an approver, and who may give it. Authority flows
 * upward: the approvers of the matched tier and of every higher tier qualify,
 * as in `canApproveRequest`. Only approvers with a console PIN are offered,
 * and never the person recording the scrap.
 */
export async function getScrapApprovalRequirement(
  serviceRole: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; recordedBy: string; estimatedValue: number }
): Promise<ScrapApprovalRequirement> {
  const matched = await getApprovalRuleByAmount(
    serviceRole,
    "scrap",
    args.companyId,
    args.estimatedValue
  );
  // Fail closed: a failed lookup must not read as "no rule".
  if (matched.error) {
    logger.error("Failed to match a scrap approval rule", {
      companyId: args.companyId,
      error: matched.error
    });
    throw new Error("Failed to read scrap approval rules");
  }
  if (!matched.data) return { required: false };

  const rules = await serviceRole
    .from("approvalRule")
    .select("approverGroupIds, defaultApproverId")
    .eq("documentType", "scrap")
    .eq("companyId", args.companyId)
    .eq("enabled", true)
    .gte("lowerBoundAmount", matched.data.lowerBoundAmount ?? 0);
  if (rules.error) {
    logger.error("Failed to read scrap approval rules", {
      companyId: args.companyId,
      error: rules.error
    });
    throw new Error("Failed to read scrap approval rules");
  }

  const expanded = await Promise.all(
    rules.data.map((rule) => getApproverUserIdsForRule(serviceRole, rule))
  );
  // `approverGroupIds` mixes group ids and user ids; the employee read below
  // keeps only this company's people.
  const candidateIds = [
    ...new Set([
      ...expanded.flat(),
      ...rules.data.flatMap((rule) => [
        ...(rule.approverGroupIds ?? []),
        ...(rule.defaultApproverId ? [rule.defaultApproverId] : [])
      ])
    ])
  ].filter((id) => id !== args.recordedBy);

  const currency = await baseCurrency(serviceRole, args.companyId);
  if (candidateIds.length === 0) {
    return {
      required: true,
      estimatedValue: args.estimatedValue,
      ...currency,
      approvers: []
    };
  }

  const [people, withPin] = await Promise.all([
    serviceRole
      .from("employees")
      .select("id, name, avatarUrl")
      .eq("companyId", args.companyId)
      .eq("active", true)
      .in("id", candidateIds),
    employeesWithPin(db, {
      companyId: args.companyId,
      employeeIds: candidateIds
    })
  ]);
  if (people.error) {
    logger.error("Failed to read scrap approvers", {
      companyId: args.companyId,
      error: people.error
    });
    throw new Error("Failed to read scrap approvers");
  }

  const approvers = (people.data ?? [])
    .filter((person) => person.id && withPin.has(person.id))
    .map((person) => ({
      id: person.id!,
      name: person.name ?? "",
      avatarUrl: person.avatarUrl ?? null
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    required: true,
    estimatedValue: args.estimatedValue,
    ...currency,
    approvers
  };
}

/** The company's base currency and its configured decimals, for showing the value. */
async function baseCurrency(
  serviceRole: SupabaseClient<Database>,
  companyId: string
): Promise<{ currencyCode: string; decimalPlaces: number }> {
  const company = await serviceRole
    .from("company")
    .select("baseCurrencyCode, companyGroupId")
    .eq("id", companyId)
    .maybeSingle();
  // Fail closed: the approver must not sign a value in the wrong currency.
  if (company.error) {
    logger.error("Failed to read the company base currency", {
      companyId,
      error: company.error
    });
    throw new Error("Failed to read the company base currency");
  }
  const currencyCode = company.data?.baseCurrencyCode ?? "USD";
  const currency = company.data?.companyGroupId
    ? await serviceRole
        .from("currency")
        .select("decimalPlaces")
        .eq("code", currencyCode)
        .eq("companyGroupId", company.data.companyGroupId)
        .maybeSingle()
    : null;
  if (currency?.error) {
    logger.error("Failed to read the base currency's decimal places", {
      companyId,
      currencyCode,
      error: currency.error
    });
    throw new Error("Failed to read the base currency's decimal places");
  }
  return { currencyCode, decimalPlaces: currency?.data?.decimalPlaces ?? 2 };
}

/**
 * The approver's authority for this scrap, after their PIN was checked. The
 * person recording the scrap never approves it at the tablet; `allowSelf` is
 * for the ERP, where an approver records scrap on their own authority.
 */
export async function authorizeScrapApprover(
  serviceRole: SupabaseClient<Database>,
  args: {
    companyId: string;
    approverId: string;
    recordedBy: string;
    estimatedValue: number;
    allowSelf?: boolean;
  }
): Promise<
  { error: null } | { error: { code: "self" | "forbidden"; message: string } }
> {
  const canApprove = await canApproveRequest(
    serviceRole,
    {
      amount: args.estimatedValue,
      documentType: "scrap",
      companyId: args.companyId
    },
    args.approverId
  );
  return scrapApproverRefusal({
    approverId: args.approverId,
    recordedBy: args.recordedBy,
    canApprove,
    allowSelf: args.allowSelf ?? false
  });
}

/**
 * Records an approved scrap before it posts: the `scrapRequest` and its
 * Approved `approvalRequest`, in one transaction. The caller posts the scrap
 * next and then calls `markScrapApprovalPosted`, or `discardScrapApproval`
 * when the posting refused it. So every posted scrap that needed approval
 * has a record; a crash in between leaves a record with no `postedAt`.
 */
export async function recordScrapApproval(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    scrap: ScrapDescription;
    recordedBy: string;
    approvedBy: string;
    decisionNotes?: string;
  }
): Promise<{ scrapRequestId: string; approvalRequestId: string }> {
  const now = datetime.timestamp();
  return db.transaction().execute(async (trx) => {
    const scrapRequest = await trx
      .insertInto("scrapRequest")
      .values({
        companyId: args.companyId,
        jobId: args.scrap.jobId,
        jobOperationId: args.scrap.jobOperationId,
        jobOperationBatchId: args.scrap.jobOperationBatchId,
        jobMaterialId: args.scrap.jobMaterialId,
        trackedEntityId: args.scrap.trackedEntityId,
        itemId: args.scrap.itemId,
        scrapReasonId: args.scrap.scrapReasonId,
        quantity: args.scrap.quantity,
        estimatedValue: args.scrap.estimatedValue,
        notes: args.scrap.notes,
        createdBy: args.recordedBy
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    const approvalRequest = await trx
      .insertInto("approvalRequest")
      .values({
        documentType: "scrap",
        documentId: scrapRequest.id,
        companyId: args.companyId,
        status: "Approved",
        amount: args.scrap.estimatedValue,
        requestedBy: args.recordedBy,
        requestedAt: now,
        decisionBy: args.approvedBy,
        decisionAt: now,
        decisionNotes: args.decisionNotes ?? null,
        createdBy: args.recordedBy
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    return {
      scrapRequestId: scrapRequest.id,
      approvalRequestId: approvalRequest.id
    };
  });
}

export async function markScrapApprovalPosted(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; scrapRequestId: string; userId: string }
): Promise<void> {
  const now = datetime.timestamp();
  await db
    .updateTable("scrapRequest")
    .set({ postedAt: now, updatedBy: args.userId, updatedAt: now })
    .where("id", "=", args.scrapRequestId)
    .where("companyId", "=", args.companyId)
    .execute();
}

/** Removes the record of a scrap whose posting refused it: nothing was scrapped. */
export async function discardScrapApproval(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; scrapRequestId: string }
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom("approvalRequest")
      .where("documentType", "=", "scrap")
      .where("documentId", "=", args.scrapRequestId)
      .where("companyId", "=", args.companyId)
      .execute();
    await trx
      .deleteFrom("scrapRequest")
      .where("id", "=", args.scrapRequestId)
      .where("companyId", "=", args.companyId)
      .where("postedAt", "is", null)
      .execute();
  });
}

/**
 * Whether a batch completion's scrap was already approved: phase 1 of the
 * completion committed it, so a resumed completion posts it without asking
 * again. Only a batch past phase 1 qualifies, and only for the quantity that
 * was approved: a record kept from a failed attempt on an Active batch never
 * lets a different scrap through.
 */
export async function hasBatchScrapApproval(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; jobOperationBatchId: string; quantity: number }
): Promise<boolean> {
  const rows = await db
    .selectFrom("scrapRequest")
    .innerJoin("jobOperationBatch", (join) =>
      join
        .onRef("jobOperationBatch.id", "=", "scrapRequest.jobOperationBatchId")
        .onRef("jobOperationBatch.companyId", "=", "scrapRequest.companyId")
    )
    .select("scrapRequest.quantity")
    .where("scrapRequest.companyId", "=", args.companyId)
    .where("scrapRequest.jobOperationBatchId", "=", args.jobOperationBatchId)
    .where("jobOperationBatch.status", "in", ["Completing", "Completed"])
    .execute();
  return rows.some((row) => equals(Number(row.quantity), args.quantity));
}

/**
 * Every approved scrap of the company, newest first, for the ERP list. A row
 * with no `postedAt` was approved but its posting never confirmed (it failed
 * without a refusal, or is in flight).
 */
export async function getScrapApprovals(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  args: { limit: number; offset: number; jobId?: string | null }
) {
  // No rows without the feature: the page shows the upgrade overlay, so the
  // loader must not throw, and the records stay behind the entitlement.
  if (
    !(await companyHasFeature(serviceRole, companyId, {
      feature: "APPROVAL_RULES"
    }))
  ) {
    return { data: [], count: 0, error: null };
  }

  let query = serviceRole
    .from("scrapRequests")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);
  if (args.jobId) query = query.eq("jobId", args.jobId);
  return query
    .order("createdAt", { ascending: false })
    .range(args.offset, args.offset + args.limit - 1);
}
