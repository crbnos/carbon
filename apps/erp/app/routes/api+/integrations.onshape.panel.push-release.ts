import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import type {
  ItemEdit,
  OnshapeBomNode,
  ProposedItem,
  ReleasePlanItem
} from "@carbon/ee";
import {
  bomLineItemType,
  changeNoticeDescriptionJson,
  isModelReleaseItem,
  mergeChangeNoticeEdit,
  mergeEditsForCreates,
  pickLatestRow,
  proposeItem
} from "@carbon/ee";
import type { StoredReleasePlan } from "@carbon/ee/onshape";
import {
  chunkFilterValues,
  loadActiveMakeMethods,
  peekPanelPlan,
  selectInBatches,
  takePanelPlan
} from "@carbon/ee/onshape";
import { trigger } from "@carbon/jobs";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import {
  createRevision,
  type getItem,
  insertChangeNotice,
  updateDefaultRevision,
  upsertPart
} from "~/modules/items";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";

export const config = {
  runtime: "nodejs"
};

// Edits arrive as free strings. `mergeItemEdits` is the validator — an
// unknown enum value, a unit the company lacks or an empty name comes back
// as a 422 naming the row, not a blanket 400 — so the schema pins only the
// shape and the cast to ItemEdit below is safe.
const itemEditSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  replenishmentSystem: z.string().optional(),
  defaultMethodType: z.string().optional(),
  itemTrackingType: z.string().optional(),
  unitOfMeasureCode: z.string().optional()
});

const payloadSchema = z.object({
  planId: z.string().min(1),
  edits: z.record(z.string(), itemEditSchema).default({}),
  changeNotice: z
    .object({
      name: z.string().optional(),
      description: z.string().nullable().optional()
    })
    .nullable()
    .optional(),
  makeDefault: z.boolean().optional()
});

type PushSummary = {
  releaseName: string | null;
  revisionsCreated: number;
  itemsCreated: number;
  reused: number;
  linesWritten: number;
  methodsTouched: number;
  defaultsUpdated: number;
  changeNotice: string | null;
  alreadyPushed: boolean;
  skipped: string[];
  errors: string[];
};

type ItemRow = {
  id: string;
  readableId: string;
  revision: string;
  name: string;
  type: string | null;
  defaultMethodType: string | null;
  unitOfMeasureCode: string | null;
};

type CreatedEntry = {
  partNumber: string;
  revision: string;
  itemId: string;
  baseItemId: string | null;
};

/** The `upsertPart` create payload for a reviewed proposal. */
function partInsert(proposed: ProposedItem, companyId: string, userId: string) {
  return {
    id: proposed.readableId,
    name: proposed.name,
    description: proposed.description ?? undefined,
    revision: proposed.revision,
    replenishmentSystem: proposed.replenishmentSystem,
    defaultMethodType: proposed.defaultMethodType,
    itemTrackingType: proposed.itemTrackingType,
    unitOfMeasureCode: proposed.unitOfMeasureCode,
    companyId,
    createdBy: userId
  } as any;
}

/**
 * Apply a reviewed release plan to Carbon.
 *
 * The plan (`plan-release`) holds every Onshape read the push needs — the
 * release's items and each released assembly's BOM at its version — so this
 * route reads nothing from Onshape: it takes the plan (once; the store hands
 * it out with GETDEL), merges the user's edits for the items it will create,
 * and writes. Carbon's state at apply time outranks the plan's pins: a letter
 * that appeared since the review is reused, a base that vanished falls back
 * to the first remaining revision, a part number that gained a row is
 * revised rather than created twice.
 *
 * Per released part/assembly: ensure a Carbon item AT the released letter —
 * `createRevision` from the base item (active; made the default when the
 * review asked for it, so consuming lines cut over) or a fresh item with the
 * reviewed values when the part number was never in Carbon. Released
 * assemblies then get the plan's BOM lines applied to the new revision's
 * Draft make method: the revision copy's Onshape-origin lines (found through
 * the base method's mapping rows) and any lines a previous release push
 * wrote are replaced, manual lines survive. One Draft change notice, named
 * and described from the review, records what was created; asset exports
 * (models + thumbnails, released drawings as PDF) run as background jobs
 * keyed by plan + item + element so a retried apply cannot queue them twice.
 * Re-applying a release that is already in Carbon re-applies BOMs and assets
 * and creates nothing (idempotent on the release's part number + letter
 * pairs).
 */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
    update: "parts"
  });

  const parsed = payloadSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return data({ error: "Invalid push payload" }, { status: 400 });
  }
  const { planId, changeNotice: changeNoticeEdit } = parsed.data;
  const edits = parsed.data.edits as Record<string, ItemEdit>;

  // Peek first: a 422 on the edits must leave the plan in place so the user
  // can fix a field and apply again; the plan is taken only once the writes
  // are about to start.
  const stored = await peekPanelPlan(planId, { companyId, userId });
  if (!stored) {
    return data(
      { error: "This review has expired — review again" },
      { status: 410 }
    );
  }
  if (stored.plan.kind !== "release") {
    return data(
      { error: "This review is not a release push" },
      { status: 400 }
    );
  }
  const plan = stored.plan as StoredReleasePlan;
  const makeDefault = parsed.data.makeDefault ?? plan.makeDefault;

  // ---- Merge the review's edits before any write --------------------------
  // Items and children are keyed by part number; the two sets are disjoint
  // by construction (a child is a BOM row that is not a release item).
  const merged = mergeEditsForCreates(
    [
      ...plan.items
        .filter((item) => item.action === "create" && item.proposed)
        .map((item) => ({
          key: item.partNumber,
          proposed: item.proposed as ProposedItem
        })),
      ...plan.children
        .filter((child) => child.action === "create" && child.proposed)
        .map((child) => ({
          key: child.partNumber,
          proposed: child.proposed as ProposedItem
        }))
    ],
    edits,
    plan.options
  );
  // A re-push plan carries no change notice; merge against the default name
  // anyway, because a row that vanished since the review turns into a create
  // and the notice is then needed.
  const changeNoticeMerge = mergeChangeNoticeEdit(
    plan.changeNotice ?? {
      name: plan.releaseName ?? `Onshape release ${plan.releaseId}`,
      description: null
    },
    changeNoticeEdit
  );
  if (!changeNoticeMerge.ok) {
    return data(
      {
        error: "Some edits are not valid",
        fieldErrors: [
          ...merged.errors,
          { key: "changeNotice", errors: changeNoticeMerge.errors }
        ]
      },
      { status: 422 }
    );
  }
  if (merged.errors.length > 0) {
    return data(
      { error: "Some edits are not valid", fieldErrors: merged.errors },
      { status: 422 }
    );
  }
  const changeNoticeValues = changeNoticeMerge.changeNotice;

  // One-shot from here: a concurrent apply of the same review finds nothing.
  if (!(await takePanelPlan(planId, { companyId, userId }))) {
    return data(
      { error: "This review has expired — review again" },
      { status: 410 }
    );
  }

  const modelItems = plan.items.filter(isModelReleaseItem);
  const drawingItems = plan.items.filter((item) => !isModelReleaseItem(item));

  const summary: PushSummary = {
    releaseName: plan.releaseName,
    revisionsCreated: 0,
    itemsCreated: 0,
    reused: 0,
    linesWritten: 0,
    methodsTouched: 0,
    defaultsUpdated: 0,
    changeNotice: null,
    alreadyPushed: false,
    skipped: [],
    errors: []
  };

  // ---- Re-resolve Carbon rows for every part number (all revisions) -------
  // The plan may be minutes old. Every release part number and every level-1
  // BOM child is read again in one query so the decisions below rest on what
  // Carbon holds now, not on what it held at review time.
  const partNumbers = [
    ...new Set([
      ...modelItems.map((item) => item.partNumber),
      ...Object.values(plan.bomLinesByElementId)
        .flatMap((lines) => (lines ?? []).map((line) => line.partNumber))
        .filter((partNumber): partNumber is string => !!partNumber)
    ])
  ];
  const existing = await selectInBatches(partNumbers, (batch) =>
    client
      .from("item")
      .select(
        "id, readableId, revision, name, type, defaultMethodType, unitOfMeasureCode"
      )
      .eq("companyId", companyId)
      .in("readableId", batch)
      .order("revision")
  );
  if (existing.error) {
    return data({ error: "Failed to read Carbon items" }, { status: 500 });
  }
  // Each batch is sorted within itself, so the concatenation is not. Re-sorted
  // to preserve the ascending order this read has always had — no consumer
  // depends on it today (every pick below compares revisions directly rather
  // than taking a position), but the reads document themselves as ordered and
  // a future reader should be able to rely on that.
  existing.data.sort((a, b) =>
    (a.revision ?? "").localeCompare(b.revision ?? "")
  );
  const byReadable = new Map<string, ItemRow[]>();
  const rememberRow = (row: ItemRow) => {
    const list = byReadable.get(row.readableId) ?? [];
    list.push(row);
    byReadable.set(row.readableId, list);
  };
  for (const row of (existing.data ?? []) as ItemRow[]) rememberRow(row);
  const letterRowFor = (partNumber: string, revision: string) =>
    (byReadable.get(partNumber) ?? []).find((row) => row.revision === revision);

  // ---- Pass 1: ensure an item at every released revision letter -----------
  const created: CreatedEntry[] = [];
  const revisionItemByPartNumber = new Map<string, ItemRow>();

  // Decide first, then read every base in one query, then write. The plan
  // pinned the base it showed ("Rev B from Rev A"); it is honoured while the
  // row exists, else the first remaining revision stands in, as before plans.
  type Decision =
    | { item: ReleasePlanItem; kind: "reuse"; row: ItemRow }
    | { item: ReleasePlanItem; kind: "revision"; base: ItemRow }
    | { item: ReleasePlanItem; kind: "create"; proposed: ProposedItem };
  const decisions: Decision[] = modelItems.map((item): Decision => {
    const existingLetter = letterRowFor(item.partNumber, item.revision);
    if (existingLetter) return { item, kind: "reuse", row: existingLetter };
    const bases = byReadable.get(item.partNumber) ?? [];
    const base =
      bases.find((row) => row.id === item.baseItemId) ?? pickLatestRow(bases);
    if (base) return { item, kind: "revision", base };
    return {
      item,
      kind: "create",
      // The reviewed values, or — when the review expected a base that is
      // gone — the same bare defaults a create always started from.
      proposed:
        merged.items.get(item.partNumber) ??
        proposeItem(
          { partNumber: item.partNumber, name: null, revision: item.revision },
          plan.options
        )
    };
  });

  // An assembly whose BOM the review could not read is not minted at all: a
  // revision copied from the base would carry the base's Onshape lines with
  // no mapping rows, and a fresh item would have no BOM — both are wrong in
  // ways a later push cannot repair. Reuse is unaffected (nothing is written).
  for (const decision of decisions) {
    if (
      decision.kind !== "reuse" &&
      decision.item.elementType === 1 &&
      plan.bomLinesByElementId[decision.item.elementId] === null
    ) {
      summary.errors.push(
        `${decision.item.partNumber} Rev ${decision.item.revision}: the BOM was not read at review — review and push again`
      );
    }
  }
  const applicable = decisions.filter(
    (decision) =>
      decision.kind === "reuse" ||
      decision.item.elementType !== 1 ||
      plan.bomLinesByElementId[decision.item.elementId] !== null
  );
  decisions.length = 0;
  decisions.push(...applicable);

  const baseIds = [
    ...new Set(
      decisions.flatMap((decision) =>
        decision.kind === "revision" ? [decision.base.id] : []
      )
    )
  ];
  type FullItem = NonNullable<Awaited<ReturnType<typeof getItem>>["data"]>;
  const fullBaseById = new Map<string, FullItem>();
  const bases = await selectInBatches(baseIds, (batch) =>
    client.from("item").select("*").eq("companyId", companyId).in("id", batch)
  );
  for (const row of bases.data as FullItem[]) {
    fullBaseById.set(row.id, row);
  }

  for (const decision of decisions) {
    const { item } = decision;
    if (decision.kind === "reuse") {
      summary.reused += 1;
      revisionItemByPartNumber.set(item.partNumber, decision.row);
      continue;
    }

    let row: ItemRow | null = null;
    if (decision.kind === "revision") {
      const full = fullBaseById.get(decision.base.id);
      if (!full) {
        summary.errors.push(`${item.partNumber}: failed to read the base item`);
        continue;
      }
      const inserted = await createRevision(client, {
        item: full,
        revision: item.revision,
        createdBy: userId,
        active: true
      });
      if (inserted.error || !inserted.data) {
        summary.errors.push(
          `${item.partNumber}: ${
            inserted.error?.message ?? "failed to create the revision"
          }`
        );
        continue;
      }
      row = {
        id: inserted.data.id,
        readableId: item.partNumber,
        revision: item.revision,
        name: full.name,
        type: full.type,
        defaultMethodType: full.defaultMethodType ?? "Make to Order",
        unitOfMeasureCode: full.unitOfMeasureCode ?? "EA"
      };
      created.push({
        partNumber: item.partNumber,
        revision: item.revision,
        itemId: row.id,
        baseItemId: decision.base.id
      });
      summary.revisionsCreated += 1;
    } else {
      // Never in Carbon: create the item directly at the released letter with
      // the values the user reviewed. `upsertPart` reads the new id back by
      // readableId, which is only right because no other revision exists.
      const { proposed } = decision;
      const insertedItem = await upsertPart(
        client,
        partInsert(proposed, companyId, userId)
      );
      if (insertedItem.error || !insertedItem.data) {
        summary.errors.push(
          `${item.partNumber}: ${
            insertedItem.error?.message ?? "failed to create the item"
          }`
        );
        continue;
      }
      row = {
        id: insertedItem.data.id as string,
        readableId: item.partNumber,
        revision: item.revision,
        name: proposed.name,
        type: "Part",
        defaultMethodType: proposed.defaultMethodType,
        unitOfMeasureCode: proposed.unitOfMeasureCode
      };
      created.push({
        partNumber: item.partNumber,
        revision: item.revision,
        itemId: row.id,
        baseItemId: null
      });
      summary.itemsCreated += 1;
    }

    revisionItemByPartNumber.set(item.partNumber, row);
    rememberRow(row);
  }

  summary.alreadyPushed = created.length === 0;

  // ---- Pass 2: BOMs for released assemblies -------------------------------
  const serviceRole = getCarbonServiceRole();

  // Active make methods for every target and every base in one query. The
  // map is reused by the change notice below: nothing this route writes
  // changes which method is active.
  const methodByItemId = await loadActiveMakeMethods(client, companyId, [
    ...[...revisionItemByPartNumber.values()].map((row) => row.id),
    ...created.flatMap((entry) => (entry.baseItemId ? [entry.baseItemId] : []))
  ]);

  // 2a — which assemblies take their BOM. Status is re-checked here: a method
  // released between review and apply is refused, as it always was.
  type BomTarget = {
    item: ReleasePlanItem;
    label: string;
    methodId: string;
    lines: OnshapeBomNode[];
    /** The base method whose Onshape-origin lines the revision copy carries. */
    baseMethodId: string | null;
  };
  const bomTargets: BomTarget[] = [];
  for (const item of modelItems.filter(
    (candidate) => candidate.elementType === 1
  )) {
    const target = revisionItemByPartNumber.get(item.partNumber);
    if (!target) continue; // creation failed above; error already recorded
    const label = `${item.partNumber} Rev ${item.revision}`;

    const method = methodByItemId.get(target.id);
    if (!method) {
      summary.errors.push(`${label}: no make method found`);
      continue;
    }
    if (method.status === "Active") {
      summary.errors.push(
        `${label}: make method is released in Carbon; refusing to rewrite it`
      );
      continue;
    }

    // A BOM the review could not read is stored as null and leaves the
    // method alone — deleting its Onshape-origin lines on the strength of a
    // failed read would turn a transient Onshape error into an erased BOM. A
    // genuinely empty BOM is an empty array and is applied like any other.
    const lines = plan.bomLinesByElementId[item.elementId];
    if (!lines) {
      summary.skipped.push(
        `${label}: the BOM was not read at review — review and push again`
      );
      continue;
    }

    const createdEntry = created.find(
      (candidate) =>
        candidate.partNumber === item.partNumber &&
        candidate.revision === item.revision
    );
    bomTargets.push({
      item,
      label,
      methodId: method.id,
      lines,
      baseMethodId: createdEntry?.baseItemId
        ? (methodByItemId.get(createdEntry.baseItemId)?.id ?? null)
        : null
    });
  }

  // 2b — resolve every line's item once: the same release's letter item,
  // else any existing revision (purchased hardware is reused, never
  // re-minted), else a create with the reviewed values. A child the review
  // expected to reuse but which vanished since gets the bare defaults.
  const childItemByPartNumber = new Map<string, ItemRow>();
  const childFailed = new Set<string>();
  for (const target of bomTargets) {
    for (const child of target.lines) {
      if (!child.partNumber) continue;
      if (
        childItemByPartNumber.has(child.partNumber) ||
        childFailed.has(child.partNumber)
      ) {
        continue;
      }
      const existingChild =
        revisionItemByPartNumber.get(child.partNumber) ??
        pickLatestRow(byReadable.get(child.partNumber) ?? []);
      if (existingChild) {
        childItemByPartNumber.set(child.partNumber, existingChild);
        continue;
      }
      const proposed =
        merged.items.get(child.partNumber) ??
        proposeItem(
          {
            partNumber: child.partNumber,
            name: child.name,
            description: child.description,
            revision: child.revision,
            purchased: child.purchased
          },
          plan.options
        );
      const createdChild = await upsertPart(
        client,
        partInsert(proposed, companyId, userId)
      );
      if (createdChild.error || !createdChild.data) {
        summary.errors.push(
          `${target.label} → ${child.partNumber}: ${
            createdChild.error?.message ?? "failed to create the item"
          }`
        );
        childFailed.add(child.partNumber);
        continue;
      }
      const childRow: ItemRow = {
        id: createdChild.data.id as string,
        readableId: child.partNumber,
        revision: proposed.revision,
        name: proposed.name,
        type: "Part",
        defaultMethodType: proposed.defaultMethodType,
        unitOfMeasureCode: proposed.unitOfMeasureCode
      };
      childItemByPartNumber.set(child.partNumber, childRow);
      rememberRow(childRow);
      summary.itemsCreated += 1;
    }
  }

  // Methods of children that are themselves made (sub-assemblies): a line
  // points at the child's method. One query over the ones not already known.
  const madeChildItemIds = [
    ...new Set(
      bomTargets.flatMap((target) =>
        target.lines.flatMap((child) => {
          if (!child.partNumber || child.children.length === 0) return [];
          const row = childItemByPartNumber.get(child.partNumber);
          return row && !methodByItemId.has(row.id) ? [row.id] : [];
        })
      )
    )
  ];
  for (const [itemId, method] of await loadActiveMakeMethods(
    client,
    companyId,
    madeChildItemIds
  )) {
    methodByItemId.set(itemId, method);
  }

  // 2c — clear what the release replaces, in bulk across every target.
  // First the revision copies: `createRevision` carried the base method's
  // lines over, and the ones a panel push wrote to the BASE method (found
  // through the base method's mapping rows, matched by item + order +
  // quantity) would duplicate the released BOM below; manual lines stay.
  const baseMethodIdByTargetMethodId = new Map<string, string>(
    bomTargets.flatMap(
      (target): Array<[string, string]> =>
        target.baseMethodId ? [[target.methodId, target.baseMethodId]] : []
    )
  );
  const baseMethodIds = [...new Set(baseMethodIdByTargetMethodId.values())];
  if (baseMethodIds.length > 0) {
    const baseMapped = await selectInBatches(baseMethodIds, (batch) =>
      serviceRole
        .from("externalIntegrationMapping")
        .select("entityId")
        .eq("companyId", companyId)
        .eq("integration", "onshape")
        .eq("entityType", "methodMaterial")
        .in("metadata->>makeMethodId", batch)
    );
    // This whole block exists to stop the released BOM being written on top
    // of the lines the revision copy already carried over. A failed read
    // degrades to "nothing to dedupe", which is precisely the case that
    // doubles every line — so report it rather than proceeding blind.
    if (baseMapped.error) {
      summary.errors.push(
        `Could not identify the Onshape lines copied from the base revisions (${baseMapped.error.message}); released BOMs may contain duplicates`
      );
    }
    const baseLineIds = (baseMapped.data ?? []).map(
      (mapping) => mapping.entityId
    );
    if (baseLineIds.length > 0) {
      const lineKey = (line: {
        itemId: string;
        order: number;
        quantity: number;
      }) => `${line.itemId}:${line.order}:${line.quantity}`;
      const [baseLines, copies] = await Promise.all([
        selectInBatches(baseLineIds, (batch) =>
          client
            .from("methodMaterial")
            .select("makeMethodId, itemId, order, quantity")
            .eq("companyId", companyId)
            .in("id", batch)
        ),
        selectInBatches([...baseMethodIdByTargetMethodId.keys()], (batch) =>
          client
            .from("methodMaterial")
            .select("id, makeMethodId, itemId, order, quantity")
            .eq("companyId", companyId)
            .in("makeMethodId", batch)
        )
      ]);
      if (baseLines.error || copies.error) {
        summary.errors.push(
          `Could not compare the copied lines against the base revisions (${
            (baseLines.error ?? copies.error)?.message ?? "read failed"
          }); released BOMs may contain duplicates`
        );
      }
      const copiedKeysByBaseMethodId = new Map<string, Set<string>>();
      for (const line of baseLines.data ?? []) {
        const keys =
          copiedKeysByBaseMethodId.get(line.makeMethodId) ?? new Set<string>();
        keys.add(lineKey(line));
        copiedKeysByBaseMethodId.set(line.makeMethodId, keys);
      }
      const toDelete = (copies.data ?? [])
        .filter((line) => {
          const baseMethodId = baseMethodIdByTargetMethodId.get(
            line.makeMethodId
          );
          return (
            !!baseMethodId &&
            copiedKeysByBaseMethodId.get(baseMethodId)?.has(lineKey(line))
          );
        })
        .map((line) => line.id);
      for (const batch of chunkFilterValues(toDelete)) {
        const deduped = await client
          .from("methodMaterial")
          .delete()
          .in("id", batch);
        if (deduped.error) {
          summary.errors.push(
            `Could not remove the lines copied from the base revisions (${deduped.error.message}); released BOMs may contain duplicates`
          );
        }
      }
    }
  }

  // Then the lines a previous release push wrote to the target methods.
  const targetMethodIds = bomTargets.map((target) => target.methodId);
  if (targetMethodIds.length > 0) {
    const mapped = await selectInBatches(targetMethodIds, (batch) =>
      serviceRole
        .from("externalIntegrationMapping")
        .select("id, entityId")
        .eq("companyId", companyId)
        .eq("integration", "onshape")
        .eq("entityType", "methodMaterial")
        .in("metadata->>makeMethodId", batch)
    );
    if (mapped.error) {
      summary.errors.push(
        `Could not find the lines a previous release push wrote (${mapped.error.message}); this push may add a second copy of them`
      );
    }
    for (const batch of chunkFilterValues(
      mapped.data.map((mapping) => mapping.entityId)
    )) {
      const removedLines = await client
        .from("methodMaterial")
        .delete()
        .in("id", batch);
      if (removedLines.error) {
        summary.errors.push(
          `Could not replace the lines a previous release push wrote (${removedLines.error.message}); this push may add a second copy of them`
        );
      }
    }
    for (const batch of chunkFilterValues(
      mapped.data.map((mapping) => mapping.id)
    )) {
      const removedMappings = await serviceRole
        .from("externalIntegrationMapping")
        .delete()
        .in("id", batch);
      if (removedMappings.error) {
        summary.errors.push(
          `Could not clear the ownership records for the replaced released lines (${removedMappings.error.message})`
        );
      }
    }
  }
  summary.methodsTouched += bomTargets.length;

  // 2d — write the released lines. Level-1 only: deeper levels belong to the
  // released subassemblies' own methods, which this release populates
  // through their own entries.
  for (const target of bomTargets) {
    const { item, label, methodId } = target;
    let order = 0;
    for (const child of target.lines) {
      if (!child.partNumber) {
        summary.skipped.push(
          `${label} → ${child.name ?? child.index}: no part number in Onshape`
        );
        continue;
      }
      const childItem = childItemByPartNumber.get(child.partNumber);
      if (!childItem) continue; // creation failed above; error already recorded

      // A reused Material is a Material line; a Tool cannot be a line at all.
      const itemType = bomLineItemType(childItem);
      if (!itemType) {
        summary.errors.push(
          `${label} → ${child.partNumber}: a ${
            childItem.type ?? "Part"
          } item cannot be a BOM line`
        );
        continue;
      }

      const childMethod =
        child.children.length > 0 ? methodByItemId.get(childItem.id) : null;

      const inserted = await client
        .from("methodMaterial")
        .insert({
          itemId: childItem.id,
          quantity: child.quantity,
          makeMethodId: methodId,
          materialMakeMethodId: childMethod?.id ?? null,
          methodType:
            (childItem.defaultMethodType as "Make to Order" | null) ??
            (child.purchased ? "Pull from Inventory" : "Make to Order"),
          order,
          itemType,
          unitOfMeasureCode: childItem.unitOfMeasureCode ?? "EA",
          companyId,
          createdBy: userId
        } as any)
        .select("id")
        .single();
      if (inserted.error || !inserted.data) {
        summary.errors.push(
          `${label} → ${child.partNumber}: ${
            inserted.error?.message ?? "line insert failed"
          }`
        );
        continue;
      }
      order += 1;
      summary.linesWritten += 1;

      // A released line with no ownership record is indistinguishable from a
      // manual one, and manual lines are preserved across revisions by
      // design — so it would never be replaced again.
      const lineMapping = await client
        .from("externalIntegrationMapping")
        .insert({
          entityType: "methodMaterial",
          entityId: inserted.data.id,
          integration: "onshape",
          metadata: {
            makeMethodId: methodId,
            documentId: plan.documentId,
            elementId: item.elementId,
            partNumber: child.partNumber,
            index: child.index,
            releaseId: plan.releaseId
          },
          lastSyncedAt: datetime.timestamp(),
          companyId,
          createdBy: userId
        });
      if (lineMapping.error) {
        summary.errors.push(
          `${label} → ${child.partNumber}: line written but not linked to Onshape (${lineMapping.error.message}); a later push will duplicate it`
        );
      }
    }
  }

  // ---- Pass 3: release mappings + default revisions -----------------------
  for (const item of modelItems) {
    const row = revisionItemByPartNumber.get(item.partNumber);
    if (!row) continue;
    const externalId = `release:${plan.releaseId}:${item.partNumber}`;
    const pushedAt = datetime.timestamp();
    // One row per item, one per external id: both uniqueness constraints
    // depend on this delete running before the insert.
    const clearedByItem = await serviceRole
      .from("externalIntegrationMapping")
      .delete()
      .eq("companyId", companyId)
      .eq("integration", "onshape")
      .eq("entityType", "item")
      .eq("entityId", row.id);
    const clearedByExternal = clearedByItem.error
      ? null
      : await serviceRole
          .from("externalIntegrationMapping")
          .delete()
          .eq("companyId", companyId)
          .eq("integration", "onshape")
          .eq("entityType", "item")
          .eq("externalId", externalId);
    if (clearedByItem.error || clearedByExternal?.error) {
      // Inserting anyway would leave two rows for one item, which makes the
      // owned-field lock's `.maybeSingle()` error and silently unlocks
      // name and description on the item page.
      summary.errors.push(
        `${item.partNumber} Rev ${item.revision}: revision written but its previous Onshape link could not be cleared (${
          (clearedByItem.error ?? clearedByExternal?.error)?.message ??
          "delete failed"
        }); push the release again`
      );
      continue;
    }
    const releaseMapping = await client
      .from("externalIntegrationMapping")
      .insert({
        entityType: "item",
        entityId: row.id,
        integration: "onshape",
        externalId,
        metadata: {
          kind: "release",
          releaseId: plan.releaseId,
          releaseName: plan.releaseName,
          documentId: plan.documentId,
          elementId: item.elementId,
          wv: "v",
          wvId: item.versionId,
          partNumber: item.partNumber,
          revision: item.revision,
          pushedBy: userId,
          pushedAt,
          planId
        },
        lastSyncedAt: pushedAt,
        companyId,
        createdBy: userId
      });
    if (releaseMapping.error) {
      summary.errors.push(
        `${item.partNumber} Rev ${item.revision}: revision written but not linked to Onshape (${releaseMapping.error.message}); it is invisible to change detection and to Detach`
      );
    }
  }

  // New revisions become the default their consumers resolve to (the
  // product's own Make Default semantics: methodMaterial lines of sibling
  // revisions are repointed here) — only when the review asked for it.
  if (makeDefault) {
    for (const entry of created) {
      if (!entry.baseItemId) continue; // brand-new item: it is the only revision
      const updated = await updateDefaultRevision(client, {
        id: entry.itemId,
        updatedBy: userId
      });
      if (updated.error) {
        summary.errors.push(
          `${entry.partNumber}: failed to make Rev ${entry.revision} the default`
        );
      } else {
        summary.defaultsUpdated += 1;
      }
    }
  }

  // ---- Pass 4: one Draft change notice for what this push created ---------
  if (created.length > 0) {
    const description = changeNoticeDescriptionJson(
      changeNoticeValues.description
    );
    const changeNotice = await insertChangeNotice(client, {
      companyId,
      createdBy: userId,
      name: changeNoticeValues.name,
      // The description column is tiptap JSON; the key is omitted, not
      // nulled, when the review left it empty.
      ...(description ? { description: description as Json } : {}),
      // A business date on the company's calendar, never the server's day.
      openDate: datetime
        .today(await getCompanyTimeZone(client, companyId))
        .toString()
    });
    if (changeNotice.error || !changeNotice.data) {
      summary.errors.push(
        `Change notice: ${changeNotice.error?.message ?? "failed to create"}`
      );
    } else {
      summary.changeNotice = changeNotice.data.changeNoticeId;
      let sortOrder = 0;
      for (const entry of created) {
        const draftMethod = methodByItemId.get(entry.itemId);
        const baseMethod = entry.baseItemId
          ? methodByItemId.get(entry.baseItemId)
          : null;
        const affected = await client.from("changeOrderAffectedItem").insert({
          changeOrderId: changeNotice.data.id,
          itemId: entry.baseItemId ?? entry.itemId,
          changeType: entry.baseItemId ? "Revision" : "New Part",
          sortOrder,
          draftMakeMethodId:
            draftMethod?.status === "Draft" ? draftMethod.id : null,
          baseMakeMethodId: baseMethod?.id ?? null,
          newItemId: entry.baseItemId ? entry.itemId : null,
          companyId,
          createdBy: userId
        } as any);
        if (affected.error) {
          summary.errors.push(
            `Change notice item ${entry.partNumber}: ${affected.error.message}`
          );
        }
        sortOrder += 1;
      }
    }
  }

  // ---- Pass 5: asset exports at the released versions ---------------------
  const assetTargets: Array<{
    item: ReleasePlanItem;
    itemId: string;
    kind: "partstudio" | "assembly" | "drawing";
  }> = [];
  for (const item of modelItems) {
    const row = revisionItemByPartNumber.get(item.partNumber);
    if (!row) continue;
    assetTargets.push({
      item,
      itemId: row.id,
      kind: item.elementType === 1 ? "assembly" : "partstudio"
    });
  }
  for (const drawing of drawingItems) {
    // v1 drawing match: the released drawing shares its part number with a
    // model item in the same release. Anything else is skipped with a note.
    const target = revisionItemByPartNumber.get(drawing.partNumber);
    if (!target) {
      summary.skipped.push(
        `${drawing.partNumber}: drawing has no matching model item in this release`
      );
      continue;
    }
    assetTargets.push({ item: drawing, itemId: target.id, kind: "drawing" });
  }
  for (const target of assetTargets) {
    // The event id makes a retried apply idempotent per item + element: the
    // job spends live quota on every execution.
    await trigger(
      "onshape-panel-sync",
      {
        companyId,
        userId,
        itemId: target.itemId,
        documentId: plan.documentId,
        wvm: "v",
        wvmId: target.item.versionId,
        elementId: target.item.elementId,
        elementKind: target.kind,
        assetBaseName: `${target.item.partNumber}-${target.item.revision}`
      },
      { id: `${planId}:${target.itemId}:${target.item.elementId}` }
    );
  }

  return data({ summary }, { headers: { "Cache-Control": "no-store" } });
}
