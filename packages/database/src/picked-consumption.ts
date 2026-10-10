// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { consumableInWholeAssemblies } from "./supersession-pick.ts";

export type LinesideClaim = {
  jobId: string;
  jobMaterialId: string;
  staged: number;
};

export function linesideCredit(args: {
  onHand: number;
  claims: LinesideClaim[];
  consumedByJob: Map<string, number>;
  jobId: string;
  jobMaterialId: string;
}): { own: number; unclaimed: number } {
  const { claims, consumedByJob, jobId, jobMaterialId } = args;
  const stagedByJob = new Map<string, number>();
  let ownStaged = 0;
  for (const claim of claims) {
    const staged = Math.max(0, claim.staged);
    stagedByJob.set(claim.jobId, (stagedByJob.get(claim.jobId) ?? 0) + staged);
    if (claim.jobMaterialId === jobMaterialId) ownStaged += staged;
  }
  let claimed = 0;
  for (const [job, staged] of stagedByJob) {
    claimed += Math.max(0, staged - (consumedByJob.get(job) ?? 0));
  }
  const own = Math.max(0, ownStaged - (consumedByJob.get(jobId) ?? 0));
  const unclaimed = Math.max(0, Math.max(0, args.onHand) - claimed);
  return { own, unclaimed };
}

export type PickedBudget = {
  itemId: string;
  /**
   * The stock stripe the budget holds (Projects Phase 2a): a project id, or
   * null for common stock. Consumption out of the budget books this stripe.
   */
  projectId: string | null;
  factor: number;
  storageUnitId: string | null;
  sharedStorageUnitId: string | null;
  own: number;
  unclaimed: number;
  available: number;
  isInventory: boolean;
  isPredecessor: boolean;
};

export type Take = {
  budget: PickedBudget;
  quantity: number;
  fromOwn: number;
  fromShared: number;
};

export type SharedTakes = Map<string, number>;

export function sharedTakeKey(
  itemId: string,
  storageUnitId: string | null,
  projectId: string | null = null
) {
  return `${itemId}\u0000${storageUnitId ?? ""}\u0000${projectId ?? ""}`;
}

export function recordSharedTakes(takenShared: SharedTakes, takes: Take[]) {
  for (const take of takes) {
    if (take.fromShared <= 0) continue;
    const key = sharedTakeKey(
      take.budget.itemId,
      take.budget.sharedStorageUnitId,
      take.budget.projectId
    );
    takenShared.set(key, (takenShared.get(key) ?? 0) + take.fromShared);
  }
}

export function splitTakeByBin(
  take: Take
): { storageUnitId: string | null; quantity: number }[] {
  const { budget, fromOwn, fromShared } = take;
  if (
    fromShared <= 0 ||
    fromOwn <= 0 ||
    budget.storageUnitId === budget.sharedStorageUnitId
  ) {
    return [
      {
        storageUnitId:
          fromOwn > 0 ? budget.storageUnitId : budget.sharedStorageUnitId,
        quantity: take.quantity
      }
    ];
  }
  return [
    { storageUnitId: budget.storageUnitId, quantity: fromOwn },
    { storageUnitId: budget.sharedStorageUnitId, quantity: fromShared }
  ];
}

export function orderOldFirst(
  budgets: PickedBudget[],
  lineItemId: string
): PickedBudget[] {
  const rank = (b: PickedBudget) =>
    b.isPredecessor ? 0 : b.itemId === lineItemId ? 1 : 2;
  // Within one item, project stock before common stock: the same order a
  // project demand draws its stripes in.
  const stripeRank = (b: PickedBudget) => (b.projectId === null ? 1 : 0);
  return [...budgets].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.itemId.localeCompare(b.itemId) ||
      stripeRank(a) - stripeRank(b)
  );
}

export function allocateAcrossBudgets(
  quantity: number,
  budgets: PickedBudget[],
  perAssembly = 0
): { takes: Take[]; remaining: number } {
  const takes: Take[] = [];
  let remaining = quantity;
  for (const budget of budgets) {
    if (remaining <= 0) break;
    if (budget.available <= 0 || budget.factor <= 0) continue;
    const usable =
      budget.isPredecessor && perAssembly > 0
        ? consumableInWholeAssemblies(
            budget.available,
            perAssembly * budget.factor
          )
        : budget.available;
    const take = Math.min(remaining * budget.factor, usable);
    if (take <= 0) continue;
    const fromOwn = Math.min(take, Math.max(0, budget.own));
    takes.push({ budget, quantity: take, fromOwn, fromShared: take - fromOwn });
    remaining -= take / budget.factor;
  }
  return { takes, remaining: Math.max(0, remaining) };
}

type Rule = {
  itemId: string;
  successorItemId: string | null;
  conversionFactor: number;
};

export function pickFactor(
  material: {
    itemId: string;
    substitutedFromItemId?: string | null;
    substitutionFactor?: number | string | null;
  },
  pickedItemId: string,
  ruleByItem: Map<string, Rule>
): number {
  if (pickedItemId === material.itemId) return 1;
  const lineRule = ruleByItem.get(material.itemId);
  if (lineRule?.successorItemId === pickedItemId)
    return lineRule.conversionFactor;
  const pickedRule = ruleByItem.get(pickedItemId);
  if (pickedRule?.successorItemId === material.itemId) {
    return 1 / pickedRule.conversionFactor;
  }
  const sf = Number(material.substitutionFactor ?? 0);
  if (pickedItemId === material.substitutedFromItemId && sf > 0) return 1 / sf;
  return 1;
}

type Trx = any;

export async function getOperationLinesideBin(
  trx: Trx,
  args: { jobOperationId: string | null | undefined; companyId: string }
): Promise<string | null> {
  if (!args.jobOperationId) return null;
  const operation: { workCenterId: string | null } | undefined = await trx
    .selectFrom("jobOperation")
    .select(["workCenterId"])
    .where("id", "=", args.jobOperationId)
    .executeTakeFirst();
  if (!operation?.workCenterId) return null;
  const bin: { id: string } | undefined = await trx
    .selectFrom("storageUnit")
    .select(["id"])
    .where("workCenterId", "=", operation.workCenterId)
    .where("companyId", "=", args.companyId)
    .orderBy("isWorkCenterDefault", "desc")
    .orderBy("createdAt", "asc")
    .executeTakeFirst();
  return bin?.id ?? null;
}

/** A stock stripe: a project id, or null for common stock. */
type Stripe = string | null;

const stripeOf = (projectId: string | null | undefined): string =>
  projectId ?? "";

/** A key per (item, stripe), '' for common stock. */
const itemStripeKey = (itemId: string, projectId: string | null | undefined) =>
  `${itemId}\u0000${stripeOf(projectId)}`;

/** A Kysely filter: the row's projectId is one of `stripes`. */
function inStripes(eb: Trx, column: string, stripes: readonly Stripe[]) {
  const projectIds = stripes.filter((s): s is string => s !== null);
  const filters: unknown[] = [];
  if (stripes.includes(null)) filters.push(eb(column, "is", null));
  if (projectIds.length > 0) filters.push(eb(column, "in", projectIds));
  if (filters.length === 0) return eb.val(false);
  return eb.or(filters);
}

/**
 * Lineside credit per (item, stripe) for every stripe in `stripes`: each
 * stripe's own on-hand, claims and consumption, as `linesideCredit` defines
 * them. A job draws the lineside stock of its own stripes only.
 */
async function getLinesideCredits(
  trx: Trx,
  args: {
    itemIds: string[];
    storageUnitId: string;
    locationId: string;
    companyId: string;
    jobId: string;
    jobMaterialId: string;
    stripes: readonly Stripe[];
  }
): Promise<Map<string, { own: number; unclaimed: number }>> {
  const { itemIds, storageUnitId, locationId, companyId, stripes } = args;
  const [onHand, lines, consumed] = await Promise.all([
    trx
      .selectFrom("itemLedger")
      .select([
        "itemId",
        "projectId",
        (eb: Trx) => eb.fn.sum("quantity").as("quantity")
      ])
      .where("companyId", "=", companyId)
      .where("storageUnitId", "=", storageUnitId)
      .where("itemId", "in", itemIds)
      .where((eb: Trx) => inStripes(eb, "projectId", stripes))
      .groupBy(["itemId", "projectId"])
      .execute() as Promise<
      {
        itemId: string;
        projectId: string | null;
        quantity: number | string | null;
      }[]
    >,
    trx
      .selectFrom("pickingListLine as pll")
      .innerJoin("pickingList as pl", "pl.id", "pll.pickingListId")
      .innerJoin("job as j", "j.id", "pll.jobId")
      .select([
        "pll.jobId",
        "pll.jobMaterialId",
        "pll.itemId",
        "pll.projectId",
        "pll.quantityPicked",
        "pll.quantityReturned"
      ])
      .where("pll.companyId", "=", companyId)
      .where("pll.toStorageUnitId", "=", storageUnitId)
      .where("pll.itemId", "in", itemIds)
      .where("pll.status", "<>", "Cancelled")
      .where("pl.status", "<>", "Cancelled")
      .where("j.status", "in", ["Planned", "Ready", "In Progress", "Paused"])
      .where((eb: Trx) => inStripes(eb, "pll.projectId", stripes))
      .execute() as Promise<
      {
        jobId: string;
        jobMaterialId: string;
        itemId: string;
        projectId: string | null;
        quantityPicked: number | string | null;
        quantityReturned: number | string | null;
      }[]
    >,
    trx
      .selectFrom("itemLedger")
      .select([
        "itemId",
        "documentId",
        "projectId",
        (eb: Trx) => eb.fn.sum("quantity").as("quantity")
      ])
      .where("companyId", "=", companyId)
      .where("locationId", "=", locationId)
      .where("storageUnitId", "=", storageUnitId)
      .where("documentType", "=", "Job Consumption")
      .where("itemId", "in", itemIds)
      .where((eb: Trx) => inStripes(eb, "projectId", stripes))
      .groupBy(["itemId", "documentId", "projectId"])
      .execute() as Promise<
      {
        itemId: string;
        documentId: string | null;
        projectId: string | null;
        quantity: number | string | null;
      }[]
    >
  ]);
  const onHandByKey = new Map(
    onHand.map((r) => [
      itemStripeKey(r.itemId, r.projectId),
      Number(r.quantity ?? 0)
    ])
  );
  const credits = new Map<string, { own: number; unclaimed: number }>();
  for (const itemId of itemIds) {
    for (const stripe of stripes) {
      const key = itemStripeKey(itemId, stripe);
      const consumedByJob = new Map<string, number>();
      for (const row of consumed) {
        if (row.itemId !== itemId || !row.documentId) continue;
        if (stripeOf(row.projectId) !== stripeOf(stripe)) continue;
        consumedByJob.set(
          row.documentId,
          Math.max(0, -Number(row.quantity ?? 0))
        );
      }
      credits.set(
        key,
        linesideCredit({
          onHand: onHandByKey.get(key) ?? 0,
          claims: lines
            .filter(
              (l) =>
                l.itemId === itemId &&
                stripeOf(l.projectId) === stripeOf(stripe)
            )
            .map((l) => ({
              jobId: l.jobId,
              jobMaterialId: l.jobMaterialId,
              staged:
                Number(l.quantityPicked ?? 0) - Number(l.quantityReturned ?? 0)
            })),
          consumedByJob,
          jobId: args.jobId,
          jobMaterialId: args.jobMaterialId
        })
      );
    }
  }
  return credits;
}

/**
 * The budgets a material may consume, one per (item, stripe). `own` is the
 * material's own live picks of that stripe; `unclaimed` is what sits at the
 * operation's lineside bin in that stripe that no live job's pick claims.
 * `stripes` is the job's stripe set (project stock first, then common); it
 * bounds the shared pool only, since a material's own pick drew from its
 * job's stripes already. Common stock only when omitted.
 */
export async function getPickedBudgets(
  trx: Trx,
  args: {
    material: {
      id: string;
      itemId: string;
      jobId: string;
      substitutedFromItemId?: string | null;
      substitutionFactor?: number | string | null;
    };
    locationId: string;
    companyId: string;
    opStorageUnitId?: string | null;
    takenShared?: SharedTakes;
    stripes?: readonly Stripe[];
  }
): Promise<PickedBudget[]> {
  const { material, locationId, companyId, opStorageUnitId, takenShared } =
    args;
  const stripes: readonly Stripe[] =
    args.stripes && args.stripes.length > 0 ? args.stripes : [null];

  const lines: {
    itemId: string;
    projectId: string | null;
    quantityPicked: number | string | null;
    quantityReturned: number | string | null;
    toStorageUnitId: string | null;
  }[] = await trx
    .selectFrom("pickingListLine as pll")
    .innerJoin("pickingList as pl", "pl.id", "pll.pickingListId")
    .where("pll.jobMaterialId", "=", material.id)
    .where("pll.companyId", "=", companyId)
    .where("pll.status", "<>", "Cancelled")
    .where("pl.status", "<>", "Cancelled")
    .select([
      "pll.itemId",
      "pll.projectId",
      "pll.quantityPicked",
      "pll.quantityReturned",
      "pll.toStorageUnitId"
    ])
    .execute();

  // Staged per (item, stripe): a pick line moved the stripe it drew.
  const stagedByKey = new Map<string, number>();
  const binByKey = new Map<string, Map<string, number>>();
  const stagedItemIds = new Set<string>();
  const ownStripes = new Map<string, Stripe>();
  for (const line of lines) {
    const staged = Math.max(
      0,
      Number(line.quantityPicked ?? 0) - Number(line.quantityReturned ?? 0)
    );
    if (staged <= 0) continue;
    const key = itemStripeKey(line.itemId, line.projectId);
    stagedItemIds.add(line.itemId);
    ownStripes.set(key, line.projectId ?? null);
    stagedByKey.set(key, (stagedByKey.get(key) ?? 0) + staged);
    if (line.toStorageUnitId) {
      const bins = binByKey.get(key) ?? new Map<string, number>();
      bins.set(
        line.toStorageUnitId,
        (bins.get(line.toStorageUnitId) ?? 0) + staged
      );
      binByKey.set(key, bins);
    }
  }
  const seed = [
    ...new Set(
      [
        material.itemId,
        material.substitutedFromItemId ?? null,
        ...stagedItemIds
      ].filter((id): id is string => !!id)
    )
  ];
  const rules: {
    itemId: string;
    successorItemId: string | null;
    conversionFactor: number | string | null;
  }[] = await trx
    .selectFrom("itemSupersession")
    .select(["itemId", "successorItemId", "conversionFactor"])
    .where("companyId", "=", companyId)
    .where((eb: Trx) =>
      eb.or([eb("itemId", "in", seed), eb("successorItemId", "in", seed)])
    )
    .execute();
  const related = new Set(seed);
  for (const r of rules) {
    if (r.successorItemId === material.itemId) related.add(r.itemId);
    if (r.itemId === material.itemId && r.successorItemId)
      related.add(r.successorItemId);
  }
  const relatedIds = [...related];

  const credits = opStorageUnitId
    ? await getLinesideCredits(trx, {
        itemIds: relatedIds,
        storageUnitId: opStorageUnitId,
        locationId,
        companyId,
        jobId: material.jobId,
        jobMaterialId: material.id,
        stripes
      })
    : new Map<string, { own: number; unclaimed: number }>();

  // One budget per (item, stripe) that holds a live pick or unclaimed stock.
  const candidates: { itemId: string; projectId: Stripe }[] = [];
  const seen = new Set<string>();
  const addCandidate = (itemId: string, projectId: Stripe) => {
    const key = itemStripeKey(itemId, projectId);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ itemId, projectId });
  };
  for (const itemId of relatedIds) {
    for (const [key, projectId] of ownStripes) {
      if (key === itemStripeKey(itemId, projectId)) {
        addCandidate(itemId, projectId);
      }
    }
    for (const stripe of stripes) {
      if ((credits.get(itemStripeKey(itemId, stripe))?.unclaimed ?? 0) > 0) {
        addCandidate(itemId, stripe);
      }
    }
  }
  if (candidates.length === 0) return [];
  const pickedItemIds = [...new Set(candidates.map((c) => c.itemId))];
  const involved = relatedIds;

  const [consumed, items] = await Promise.all([
    trx
      .selectFrom("itemLedger")
      .select([
        "itemId",
        "projectId",
        (eb: Trx) => eb.fn.sum("quantity").as("quantity")
      ])
      .where("documentType", "=", "Job Consumption")
      .where("documentId", "=", material.jobId)
      .where("locationId", "=", locationId)
      .where("companyId", "=", companyId)
      .where("itemId", "in", pickedItemIds)
      .groupBy(["itemId", "projectId"])
      .execute() as Promise<
      {
        itemId: string;
        projectId: string | null;
        quantity: number | string | null;
      }[]
    >,
    trx
      .selectFrom("item")
      .select(["id", "itemTrackingType"])
      .where("id", "in", pickedItemIds)
      .execute() as Promise<{ id: string; itemTrackingType: string | null }[]>
  ]);

  const consumedByKey = new Map(
    consumed.map((c) => [
      itemStripeKey(c.itemId, c.projectId),
      Math.max(0, -Number(c.quantity ?? 0))
    ])
  );
  const ruleByItem = new Map<string, Rule>(
    rules.map((r) => [
      r.itemId,
      {
        itemId: r.itemId,
        successorItemId: r.successorItemId,
        conversionFactor: Number(r.conversionFactor ?? 1) || 1
      }
    ])
  );
  const trackingByItem = new Map(items.map((i) => [i.id, i.itemTrackingType]));
  const involvedSet = new Set(involved);

  return candidates.map(({ itemId, projectId }) => {
    const key = itemStripeKey(itemId, projectId);
    const bins = binByKey.get(key);
    const storageUnitId =
      (bins
        ? [...bins.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
        : undefined) ??
      opStorageUnitId ??
      null;
    const successor = ruleByItem.get(itemId)?.successorItemId;
    const own = Math.max(
      0,
      (stagedByKey.get(key) ?? 0) - (consumedByKey.get(key) ?? 0)
    );
    const sharedStorageUnitId = opStorageUnitId ?? null;
    const unclaimed = Math.max(
      0,
      (credits.get(key)?.unclaimed ?? 0) -
        (takenShared?.get(
          sharedTakeKey(itemId, sharedStorageUnitId, projectId)
        ) ?? 0)
    );
    return {
      itemId,
      projectId,
      factor: pickFactor(material, itemId, ruleByItem),
      storageUnitId,
      sharedStorageUnitId,
      own,
      unclaimed,
      available: own + unclaimed,
      isInventory: trackingByItem.get(itemId) === "Inventory",
      isPredecessor:
        !!successor && successor !== itemId && involvedSet.has(successor)
    };
  });
}
