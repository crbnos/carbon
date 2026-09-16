
import { consumableInWholeAssemblies } from "./supersession-pick.ts";

export type LinesideClaim = { jobId: string; jobMaterialId: string; staged: number };

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
  factor: number;
  storageUnitId: string | null;
  available: number;
  isInventory: boolean;
  isPredecessor: boolean;
};

type Take = { budget: PickedBudget; quantity: number };

export function orderOldFirst(
  budgets: PickedBudget[],
  lineItemId: string
): PickedBudget[] {
  const rank = (b: PickedBudget) =>
    b.isPredecessor ? 0 : b.itemId === lineItemId ? 1 : 2;
  return [...budgets].sort(
    (a, b) => rank(a) - rank(b) || a.itemId.localeCompare(b.itemId)
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
    takes.push({ budget, quantity: take });
    remaining -= take / budget.factor;
  }
  return { takes, remaining: Math.max(0, remaining) };
}

type Rule = { itemId: string; successorItemId: string | null; conversionFactor: number };

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
  if (lineRule?.successorItemId === pickedItemId) return lineRule.conversionFactor;
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

async function getLinesideCredits(
  trx: Trx,
  args: {
    itemIds: string[];
    storageUnitId: string;
    locationId: string;
    companyId: string;
    jobId: string;
    jobMaterialId: string;
  }
): Promise<Map<string, { own: number; unclaimed: number }>> {
  const { itemIds, storageUnitId, locationId, companyId } = args;
  const [onHand, lines, consumed] = await Promise.all([
    trx
      .selectFrom("itemLedger")
      .select(["itemId", (eb: Trx) => eb.fn.sum("quantity").as("quantity")])
      .where("companyId", "=", companyId)
      .where("storageUnitId", "=", storageUnitId)
      .where("itemId", "in", itemIds)
      .groupBy("itemId")
      .execute() as Promise<{ itemId: string; quantity: number | string | null }[]>,
    trx
      .selectFrom("pickingListLine as pll")
      .innerJoin("pickingList as pl", "pl.id", "pll.pickingListId")
      .innerJoin("job as j", "j.id", "pll.jobId")
      .select([
        "pll.jobId",
        "pll.jobMaterialId",
        "pll.itemId",
        "pll.quantityPicked",
        "pll.quantityReturned",
      ])
      .where("pll.companyId", "=", companyId)
      .where("pll.toStorageUnitId", "=", storageUnitId)
      .where("pll.itemId", "in", itemIds)
      .where("pll.status", "<>", "Cancelled")
      .where("pl.status", "<>", "Cancelled")
      .where("j.status", "in", ["Planned", "Ready", "In Progress", "Paused"])
      .execute() as Promise<
      {
        jobId: string;
        jobMaterialId: string;
        itemId: string;
        quantityPicked: number | string | null;
        quantityReturned: number | string | null;
      }[]
    >,
    trx
      .selectFrom("itemLedger")
      .select([
        "itemId",
        "documentId",
        (eb: Trx) => eb.fn.sum("quantity").as("quantity"),
      ])
      .where("companyId", "=", companyId)
      .where("locationId", "=", locationId)
      .where("storageUnitId", "=", storageUnitId)
      .where("documentType", "=", "Job Consumption")
      .where("itemId", "in", itemIds)
      .groupBy(["itemId", "documentId"])
      .execute() as Promise<
      { itemId: string; documentId: string | null; quantity: number | string | null }[]
    >,
  ]);
  const onHandByItem = new Map(onHand.map((r) => [r.itemId, Number(r.quantity ?? 0)]));
  const credits = new Map<string, { own: number; unclaimed: number }>();
  for (const itemId of itemIds) {
    const consumedByJob = new Map<string, number>();
    for (const row of consumed) {
      if (row.itemId !== itemId || !row.documentId) continue;
      consumedByJob.set(row.documentId, Math.max(0, -Number(row.quantity ?? 0)));
    }
    credits.set(
      itemId,
      linesideCredit({
        onHand: onHandByItem.get(itemId) ?? 0,
        claims: lines
          .filter((l) => l.itemId === itemId)
          .map((l) => ({
            jobId: l.jobId,
            jobMaterialId: l.jobMaterialId,
            staged: Number(l.quantityPicked ?? 0) - Number(l.quantityReturned ?? 0),
          })),
        consumedByJob,
        jobId: args.jobId,
        jobMaterialId: args.jobMaterialId,
      })
    );
  }
  return credits;
}

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
    takenSoFar?: Map<string, number>;
  }
): Promise<PickedBudget[]> {
  const { material, locationId, companyId, opStorageUnitId, takenSoFar } = args;

  const lines: {
    itemId: string;
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
      "pll.quantityPicked",
      "pll.quantityReturned",
      "pll.toStorageUnitId",
    ])
    .execute();

  const stagedByItem = new Map<string, number>();
  const binByItem = new Map<string, Map<string, number>>();
  for (const line of lines) {
    const staged = Math.max(
      0,
      Number(line.quantityPicked ?? 0) - Number(line.quantityReturned ?? 0)
    );
    if (staged <= 0) continue;
    stagedByItem.set(line.itemId, (stagedByItem.get(line.itemId) ?? 0) + staged);
    if (line.toStorageUnitId) {
      const bins = binByItem.get(line.itemId) ?? new Map<string, number>();
      bins.set(
        line.toStorageUnitId,
        (bins.get(line.toStorageUnitId) ?? 0) + staged
      );
      binByItem.set(line.itemId, bins);
    }
  }
  const seed = [
    ...new Set(
      [material.itemId, material.substitutedFromItemId ?? null, ...stagedByItem.keys()].filter(
        (id): id is string => !!id
      )
    ),
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
      eb.or([
        eb("itemId", "in", seed),
        eb("successorItemId", "in", seed),
      ])
    )
    .execute();
  const related = new Set(seed);
  for (const r of rules) {
    if (r.successorItemId === material.itemId) related.add(r.itemId);
    if (r.itemId === material.itemId && r.successorItemId) related.add(r.successorItemId);
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
      })
    : new Map<string, { own: number; unclaimed: number }>();

  const budgetItemIds = relatedIds.filter(
    (id) => (stagedByItem.get(id) ?? 0) > 0 || (credits.get(id)?.unclaimed ?? 0) > 0
  );
  if (budgetItemIds.length === 0) return [];
  const pickedItemIds = budgetItemIds;
  const involved = relatedIds;

  const [consumed, items] = await Promise.all([
    trx
      .selectFrom("itemLedger")
      .select(["itemId", (eb: Trx) => eb.fn.sum("quantity").as("quantity")])
      .where("documentType", "=", "Job Consumption")
      .where("documentId", "=", material.jobId)
      .where("locationId", "=", locationId)
      .where("companyId", "=", companyId)
      .where("itemId", "in", pickedItemIds)
      .groupBy("itemId")
      .execute() as Promise<{ itemId: string; quantity: number | string | null }[]>,
    trx
      .selectFrom("item")
      .select(["id", "itemTrackingType"])
      .where("id", "in", pickedItemIds)
      .execute() as Promise<{ id: string; itemTrackingType: string | null }[]>,
  ]);

  const consumedByItem = new Map(
    consumed.map((c) => [c.itemId, Math.max(0, -Number(c.quantity ?? 0))])
  );
  const ruleByItem = new Map<string, Rule>(
    rules.map((r) => [
      r.itemId,
      {
        itemId: r.itemId,
        successorItemId: r.successorItemId,
        conversionFactor: Number(r.conversionFactor ?? 1) || 1,
      },
    ])
  );
  const trackingByItem = new Map(items.map((i) => [i.id, i.itemTrackingType]));
  const involvedSet = new Set(involved);

  return pickedItemIds.map((itemId) => {
    const bins = binByItem.get(itemId);
    const storageUnitId =
      (bins
        ? [...bins.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
        : undefined) ??
      opStorageUnitId ??
      null;
    const successor = ruleByItem.get(itemId)?.successorItemId;
    const own = Math.max(
      0,
      (stagedByItem.get(itemId) ?? 0) - (consumedByItem.get(itemId) ?? 0)
    );
    return {
      itemId,
      factor: pickFactor(material, itemId, ruleByItem),
      storageUnitId,
      available: Math.max(
        0,
        own + (credits.get(itemId)?.unclaimed ?? 0) - (takenSoFar?.get(itemId) ?? 0)
      ),
      isInventory: trackingByItem.get(itemId) === "Inventory",
      isPredecessor: !!successor && successor !== itemId && involvedSet.has(successor),
    };
  });
}
