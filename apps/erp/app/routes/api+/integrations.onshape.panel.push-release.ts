// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import type {
  ItemEdit,
  ItemFieldSnapshot,
  MappedRowPlan,
  OnshapeBomNode,
  OwnedFieldChange,
  PlanCustomField,
  ProposedItem,
  ReleasePlanItem
} from "@carbon/ee";
import {
  bomLineItemType,
  changeNoticeDescriptionJson,
  createdItemExtras,
  isModelReleaseItem,
  mappedFieldValues,
  mergeChangeNoticeEdit,
  mergeCustomFieldValues,
  mergeEditsForCreates,
  pickBomChildRow,
  pickRevisionBase,
  proposeItem
} from "@carbon/ee";
import type {
  ReleaseExportSelection,
  StoredReleasePlan
} from "@carbon/ee/onshape";
import {
  chunkFilterValues,
  loadActiveMakeMethods,
  ONSHAPE_V2_INTEGRATION_ID,
  peekPanelPlan,
  releaseExportSelection,
  selectInBatches,
  takePanelPlan
} from "@carbon/ee/onshape";
import { requireOnshapePanelPermissions } from "@carbon/ee/onshape/panel-session.server";
import { trigger } from "@carbon/jobs";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import {
  createRevision,
  deleteChangeNotice,
  type getItem,
  insertChangeNotice,
  updateDefaultRevision,
  upsertPart
} from "~/modules/items";
import {
  applyExistingItemFields,
  applyItemFieldWrites,
  findOpenReleaseNotice,
  insertOwnedMethodLines,
  type OwnedMethodLine,
  stageChangeNoticeItem,
  swapItemMapping
} from "~/modules/settings/onshape-push.server";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";

export const config = {
  runtime: "nodejs"
};

// Shape only: `mergeItemEdits` validates values and answers a 422 naming the row.
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
  makeDefault: z.boolean().optional(),
  createChangeNotice: z.boolean().optional()
});

type PushSummary = {
  releaseName: string | null;
  revisionsCreated: number;
  itemsCreated: number;
  /** BOM children the push created; not on the change notice. */
  childrenCreated: number;
  drawingsQueued: number;
  drawingsOnly: boolean;
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
  active?: boolean | null;
  name: string;
  type: string | null;
  defaultMethodType: string | null;
  sourcingType: string | null;
  unitOfMeasureCode: string | null;
};

type CreatedEntry = {
  partNumber: string;
  revision: string;
  itemId: string;
  baseItemId: string | null;
};

function partInsert(
  proposed: ProposedItem,
  companyId: string,
  userId: string,
  customFields: PlanCustomField[] | undefined
) {
  const values = mappedFieldValues(customFields ?? [], true).values;
  return {
    id: proposed.readableId,
    name: proposed.name,
    description: proposed.description ?? undefined,
    revision: proposed.revision,
    replenishmentSystem: proposed.replenishmentSystem,
    defaultMethodType: proposed.defaultMethodType,
    itemTrackingType: proposed.itemTrackingType,
    unitOfMeasureCode: proposed.unitOfMeasureCode,
    ...(Object.keys(values).length > 0 ? { customFields: values as Json } : {}),
    companyId,
    createdBy: userId
  } as any;
}

/**
 * Apply a reviewed release plan. Makes no Onshape call; Carbon's state at apply time outranks the plan.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requireOnshapePanelPermissions(
    request,
    {
      create: "parts",
      update: "parts",
      // Re-pushing replaces the BOM lines an earlier push wrote.
      delete: "parts"
    }
  );

  const parsed = payloadSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return data({ error: "Invalid push payload" }, { status: 400 });
  }
  const { planId, changeNotice: changeNoticeEdit } = parsed.data;
  const edits = parsed.data.edits as Record<string, ItemEdit>;

  // Peek, not take: a 422 must leave the plan in place for a retry.
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
  // Unset: a notice whenever this push creates something.
  const createChangeNoticeChoice = parsed.data.createChangeNotice;

  // Merge the review's edits before any write.
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
  // A row that vanished since review becomes a create, so even a re-push needs notice values.
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

  const modelItems = plan.items.filter(isModelReleaseItem);
  const drawingItems = plan.items.filter((item) => !isModelReleaseItem(item));

  const summary: PushSummary = {
    releaseName: plan.releaseName,
    revisionsCreated: 0,
    itemsCreated: 0,
    childrenCreated: 0,
    drawingsQueued: 0,
    drawingsOnly: modelItems.length === 0,
    reused: 0,
    linesWritten: 0,
    methodsTouched: 0,
    defaultsUpdated: 0,
    changeNotice: null,
    alreadyPushed: false,
    skipped: [],
    errors: []
  };

  // What the plan says about each item it does not create: its current
  // fields, and for a release item the "everyPush" values and descriptions.
  // A part number that is both a release item and a BOM child uses the
  // release item's plan.
  type PlannedRow = MappedRowPlan & {
    current?: ItemFieldSnapshot | null;
    changes?: OwnedFieldChange[];
  };
  const plannedByPartNumber = new Map<string, PlannedRow>();
  for (const child of plan.children) {
    if (child.current) plannedByPartNumber.set(child.partNumber, child);
  }
  for (const item of plan.items) {
    if (item.current) plannedByPartNumber.set(item.partNumber, item);
  }
  // A create writes these at the insert; a revision copies its base and is
  // not a creation for a custom field.
  const createdFieldsByPartNumber = new Map<string, PlanCustomField[]>();
  for (const row of [...plan.children, ...plan.items]) {
    if (row.action === "create" && row.customFields) {
      createdFieldsByPartNumber.set(row.partNumber, row.customFields);
    }
  }
  const fieldEditsApplied = new Set<string>();
  /**
   * The descriptions, mapped values and reviewer edits for an item the push
   * does not create. The row's method, Sourcing and unit are updated in place,
   * because a BOM line written later copies them.
   */
  const applyItemFieldEdit = async (partNumber: string, row: ItemRow) => {
    if (fieldEditsApplied.has(partNumber)) return;
    const planned = plannedByPartNumber.get(partNumber);
    if (!planned?.current) return;
    fieldEditsApplied.add(partNumber);
    const applied = await applyExistingItemFields(client, db, {
      itemId: row.id,
      companyId,
      userId,
      current: planned.current,
      target: planned.target,
      edit: edits[partNumber],
      descriptions: planned.changes
    });
    if (applied.error) {
      summary.errors.push(`${partNumber}: ${applied.error}`);
      return;
    }
    if (applied.values) {
      row.defaultMethodType = applied.values.defaultMethodType;
      row.sourcingType = applied.values.sourcingType ?? row.sourcingType;
      row.unitOfMeasureCode =
        applied.values.unitOfMeasureCode ?? row.unitOfMeasureCode;
    }
    const values = mappedFieldValues(planned.customFields ?? [], false);
    if (values.fieldIds.size === 0) return;
    // `part` is keyed by readableId and shared by every revision.
    const held = await client
      .from("part")
      .select("customFields")
      .eq("id", partNumber)
      .eq("companyId", companyId)
      .maybeSingle();
    if (held.error) {
      summary.errors.push(
        `${partNumber}: failed to read custom fields (${held.error.message})`
      );
      return;
    }
    const updated = await client
      .from("part")
      .update({
        customFields: mergeCustomFieldValues(
          held.data?.customFields,
          values.values,
          values.fieldIds
        ) as Json,
        updatedAt: datetime.timestamp(),
        updatedBy: userId
      })
      .eq("id", partNumber)
      .eq("companyId", companyId);
    if (updated.error) {
      summary.errors.push(
        `${partNumber}: failed to write custom fields (${updated.error.message})`
      );
    }
  };
  /** The values `upsertPart` does not take: MPN, and Sourcing. */
  const writeCreatedExtras = async (
    label: string,
    itemId: string,
    proposed: ProposedItem
  ) => {
    const extras = createdItemExtras(proposed);
    if (Object.keys(extras).length === 0) return;
    const error = await applyItemFieldWrites(client, db, {
      itemId,
      companyId,
      userId,
      changed: extras
    });
    if (error) {
      summary.errors.push(
        `${label}: created, but its mapped fields were not written (${error})`
      );
    }
  };

  // Re-read every part number (all revisions): the plan may be minutes old.
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
        "id, readableId, revision, active, name, type, defaultMethodType, sourcingType, unitOfMeasureCode"
      )
      .eq("companyId", companyId)
      .in("readableId", batch)
      .order("revision")
  );
  if (existing.error) {
    return data({ error: "Failed to read Carbon items" }, { status: 500 });
  }
  const byReadable = new Map<string, ItemRow[]>();
  const rememberRow = (row: ItemRow) => {
    const list = byReadable.get(row.readableId) ?? [];
    list.push(row);
    byReadable.set(row.readableId, list);
  };
  for (const row of (existing.data ?? []) as ItemRow[]) rememberRow(row);
  const letterRowFor = (partNumber: string, revision: string) =>
    (byReadable.get(partNumber) ?? []).find((row) => row.revision === revision);

  // Pass 1: an item at every released letter.
  const created: CreatedEntry[] = [];
  const revisionItemByPartNumber = new Map<string, ItemRow>();

  // The base the plan pinned is honoured while its row exists.
  type Decision =
    | { item: ReleasePlanItem; kind: "reuse"; row: ItemRow }
    | { item: ReleasePlanItem; kind: "revision"; base: ItemRow }
    | { item: ReleasePlanItem; kind: "create"; proposed: ProposedItem };
  const decisions: Decision[] = modelItems.map((item): Decision => {
    const existingLetter = letterRowFor(item.partNumber, item.revision);
    if (existingLetter) return { item, kind: "reuse", row: existingLetter };
    const bases = byReadable.get(item.partNumber) ?? [];
    const base =
      bases.find((row) => row.id === item.baseItemId) ??
      pickRevisionBase(bases, item.revision);
    if (base) return { item, kind: "revision", base };
    return {
      item,
      kind: "create",
      proposed:
        merged.items.get(item.partNumber) ??
        proposeItem(
          { partNumber: item.partNumber, name: null, revision: item.revision },
          plan.options
        )
    };
  });

  // An assembly whose BOM was not read at review is not minted: a revision would carry the
  // base's Onshape lines with no mapping rows, and a new item would have no BOM.
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
  // A failed read would look like "no base" and skip revisions: a partial push.
  if (bases.error) {
    return data(
      { error: "Failed to read the base revisions" },
      { status: 500 }
    );
  }
  for (const row of bases.data as FullItem[]) {
    fullBaseById.set(row.id, row);
  }

  // `createRevision` copies the base's lines without mapping rows. Key its Onshape lines now:
  // once the revision exists, a failed read leaves copies that look manual.
  const assemblyBaseIds = [
    ...new Set(
      decisions.flatMap((decision) =>
        decision.kind === "revision" && decision.item.elementType === 1
          ? [decision.base.id]
          : []
      )
    )
  ];
  const lineKey = (line: { itemId: string; order: number; quantity: number }) =>
    `${line.itemId}:${line.order}:${line.quantity}`;
  let baseMethodByItemId: Awaited<ReturnType<typeof loadActiveMakeMethods>>;
  try {
    baseMethodByItemId = await loadActiveMakeMethods(
      client,
      companyId,
      assemblyBaseIds
    );
  } catch (error) {
    return data(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to read the base revisions' make methods"
      },
      { status: 500 }
    );
  }
  const serviceRole = getCarbonServiceRole();
  const db = getDatabaseClient();
  const copiedKeysByBaseMethodId = new Map<string, Set<string>>();
  const baseMethodIds = [
    ...new Set([...baseMethodByItemId.values()].map((method) => method.id))
  ];
  if (baseMethodIds.length > 0) {
    const baseMapped = await selectInBatches(baseMethodIds, (batch) =>
      serviceRole
        .from("externalIntegrationMapping")
        .select("entityId")
        .eq("companyId", companyId)
        .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
        .eq("entityType", "methodMaterial")
        .in("metadata->>makeMethodId", batch)
    );
    const baseLines = baseMapped.error
      ? null
      : await selectInBatches(
          baseMapped.data.map((mapping) => mapping.entityId),
          (batch) =>
            client
              .from("methodMaterial")
              .select("makeMethodId, itemId, order, quantity")
              .eq("companyId", companyId)
              .in("id", batch)
        );
    const baseReadError = baseMapped.error ?? baseLines?.error;
    if (baseReadError || !baseLines) {
      return data(
        {
          error: `Couldn't identify the Onshape lines on the base revisions (${
            baseReadError?.message ?? "read failed"
          }); nothing was written. Try again.`
        },
        { status: 500 }
      );
    }
    for (const line of baseLines.data) {
      const keys =
        copiedKeysByBaseMethodId.get(line.makeMethodId) ?? new Set<string>();
      keys.add(lineKey(line));
      copiedKeysByBaseMethodId.set(line.makeMethodId, keys);
    }
  }

  // Take the plan only after the reads the writes depend on, so a failed read keeps the review.
  // One-shot from here: a concurrent apply of the same review finds nothing.
  if (!(await takePanelPlan(planId, { companyId, userId }))) {
    return data(
      { error: "This review has expired — review again" },
      { status: 410 }
    );
  }

  // A notice stages what this push creates: each new revision or item is
  // inactive and owned by the notice until it is released in Carbon. Created
  // first, so every item is tied to it as it is written. A release pushed
  // from a second document adds to the notice its first push made, while
  // that notice still takes items.
  let changeNotice: { id: string; changeNoticeId: string } | null = null;
  let noticeReused = false;
  let noticeSortOrder = 0;
  const needsNotice =
    (createChangeNoticeChoice ?? true) &&
    decisions.some((decision) => decision.kind !== "reuse");
  const openNotice = needsNotice
    ? await findOpenReleaseNotice(client, companyId, plan.releaseId)
    : null;
  if (openNotice) {
    changeNotice = {
      id: openNotice.id,
      changeNoticeId: openNotice.changeNoticeId
    };
    noticeReused = true;
    noticeSortOrder = openNotice.affectedCount;
    summary.changeNotice = openNotice.changeNoticeId;
  } else if (needsNotice) {
    const description = changeNoticeDescriptionJson(
      changeNoticeValues.description
    );
    const inserted = await insertChangeNotice(client, {
      companyId,
      createdBy: userId,
      name: changeNoticeValues.name,
      // Tiptap JSON; omitted, not nulled, when empty.
      ...(description ? { description: description as Json } : {}),
      openDate: datetime
        .today(await getCompanyTimeZone(client, companyId))
        .toString()
    });
    if (inserted.error || !inserted.data) {
      return data(
        {
          error: `Couldn't create the change notice (${
            inserted.error?.message ?? "no row returned"
          }); nothing was written. Review and push again.`
        },
        { status: 500 }
      );
    }
    changeNotice = inserted.data;
    summary.changeNotice = inserted.data.changeNoticeId;
  }
  const stageInNotice = async (
    label: string,
    itemId: string,
    baseItemId: string | null
  ) => {
    if (!changeNotice) return;
    const staged = await stageChangeNoticeItem(db, {
      changeOrderId: changeNotice.id,
      companyId,
      userId,
      itemId,
      baseItemId,
      sortOrder: noticeSortOrder
    });
    noticeSortOrder += 1;
    if (staged.error) {
      summary.errors.push(
        `${label}: written but not added to change notice ${changeNotice.changeNoticeId} (${staged.error})`
      );
    }
  };

  for (const decision of decisions) {
    const { item } = decision;
    if (decision.kind === "reuse") {
      summary.reused += 1;
      revisionItemByPartNumber.set(item.partNumber, decision.row);
      await applyItemFieldEdit(item.partNumber, decision.row);
      continue;
    }

    let row: ItemRow | null = null;
    if (decision.kind === "revision") {
      const full = fullBaseById.get(decision.base.id);
      if (!full) {
        summary.errors.push(`${item.partNumber}: failed to read the base item`);
        continue;
      }
      const inserted = await createRevision(client, db, {
        item: full,
        revision: item.revision,
        createdBy: userId,
        active: !changeNotice
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
        sourcingType: full.sourcingType ?? null,
        unitOfMeasureCode: full.unitOfMeasureCode ?? "EA"
      };
      created.push({
        partNumber: item.partNumber,
        revision: item.revision,
        itemId: row.id,
        baseItemId: decision.base.id
      });
      summary.revisionsCreated += 1;
      await stageInNotice(
        `${item.partNumber} Rev ${item.revision}`,
        row.id,
        decision.base.id
      );
    } else {
      // `upsertPart` reads the new id back by readableId, safe only because no other revision exists.
      const { proposed } = decision;
      const insertedItem = await upsertPart(
        client,
        partInsert(
          proposed,
          companyId,
          userId,
          createdFieldsByPartNumber.get(item.partNumber)
        )
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
        sourcingType: proposed.sourcingType ?? null,
        unitOfMeasureCode: proposed.unitOfMeasureCode
      };
      await writeCreatedExtras(item.partNumber, row.id, proposed);
      created.push({
        partNumber: item.partNumber,
        revision: item.revision,
        itemId: row.id,
        baseItemId: null
      });
      summary.itemsCreated += 1;
      await stageInNotice(
        `${item.partNumber} Rev ${item.revision}`,
        row.id,
        null
      );
    }

    revisionItemByPartNumber.set(item.partNumber, row);
    rememberRow(row);
    await applyItemFieldEdit(item.partNumber, row);
  }

  summary.alreadyPushed = created.length === 0;
  if (changeNotice && !noticeReused && created.length === 0) {
    // Every create failed, so the notice holds nothing.
    const dropped = await deleteChangeNotice(
      client,
      db,
      changeNotice.id,
      companyId
    );
    if (dropped.error) {
      summary.errors.push(
        `Change notice ${changeNotice.changeNoticeId} is empty and could not be removed (${dropped.error.message})`
      );
    } else {
      summary.changeNotice = null;
    }
    changeNotice = null;
  }

  // Pass 2: BOMs for released assemblies. Any read failure skips every BOM write:
  // deleting or inserting on a partial read duplicates or orphans lines.
  let bomReadFailure: string | null = null;

  const methodByItemId = new Map(baseMethodByItemId);
  try {
    for (const [itemId, method] of await loadActiveMakeMethods(
      client,
      companyId,
      [
        ...[...revisionItemByPartNumber.values()].map((row) => row.id),
        ...created.flatMap((entry) =>
          entry.baseItemId ? [entry.baseItemId] : []
        )
      ]
    )) {
      methodByItemId.set(itemId, method);
    }
  } catch (error) {
    bomReadFailure =
      error instanceof Error ? error.message : "failed to read make methods";
  }

  // 2a: assemblies that take their BOM. A method released since review keeps its BOM (a skip).
  type BomTarget = {
    item: ReleasePlanItem;
    label: string;
    methodId: string;
    lines: OnshapeBomNode[];
    /** The base method whose Onshape-origin lines the revision copy carries. */
    baseMethodId: string | null;
  };
  const bomTargets: BomTarget[] = [];
  for (const item of bomReadFailure
    ? []
    : modelItems.filter((candidate) => candidate.elementType === 1)) {
    const target = revisionItemByPartNumber.get(item.partNumber);
    if (!target) continue; // creation failed above; error already recorded
    const label = `${item.partNumber} Rev ${item.revision}`;

    const method = methodByItemId.get(target.id);
    if (!method) {
      summary.errors.push(`${label}: no make method found`);
      continue;
    }
    if (method.status === "Active") {
      summary.skipped.push(
        `${label}: make method is released in Carbon, so its BOM was left as it is`
      );
      continue;
    }

    // null is a BOM the review could not read: leave the method alone rather than erase it.
    // An empty BOM is [] and is applied.
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

  // 2b: line items: this release's letter item, else the revision the BOM names (else the latest), else a create.
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
        pickBomChildRow(byReadable.get(child.partNumber) ?? [], child.revision)
          .row;
      if (existingChild) {
        childItemByPartNumber.set(child.partNumber, existingChild);
        await applyItemFieldEdit(child.partNumber, existingChild);
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
            hasChildren: child.children.length > 0,
            standardContent: child.standardContent === true
          },
          plan.options
        );
      const createdChild = await upsertPart(
        client,
        partInsert(
          proposed,
          companyId,
          userId,
          createdFieldsByPartNumber.get(child.partNumber)
        )
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
        sourcingType: proposed.sourcingType ?? null,
        unitOfMeasureCode: proposed.unitOfMeasureCode
      };
      await writeCreatedExtras(child.partNumber, childRow.id, proposed);
      childItemByPartNumber.set(child.partNumber, childRow);
      rememberRow(childRow);
      summary.childrenCreated += 1;
    }
  }

  // Sub-assembly lines, and Make to Order lines as Carbon's BOM editor does,
  // point at the child's make method.
  const madeChildItemIds = [
    ...new Set(
      bomTargets.flatMap((target) =>
        target.lines.flatMap((child) => {
          if (!child.partNumber) return [];
          const row = childItemByPartNumber.get(child.partNumber);
          // A sub-assembly, or a made part whose line is Make to Order.
          if (
            child.children.length === 0 &&
            row?.defaultMethodType !== "Make to Order"
          ) {
            return [];
          }
          return row && !methodByItemId.has(row.id) ? [row.id] : [];
        })
      )
    )
  ];
  if (!bomReadFailure) {
    try {
      for (const [itemId, method] of await loadActiveMakeMethods(
        client,
        companyId,
        madeChildItemIds
      )) {
        methodByItemId.set(itemId, method);
      }
    } catch (error) {
      // Without them every sub-assembly line would get a null method and flatten the tree.
      bomReadFailure =
        error instanceof Error
          ? error.message
          : "failed to read the sub-assemblies' make methods";
    }
  }

  // 2c: delete the revision copies of the base's Onshape lines (manual lines stay), then the
  // lines a previous release push wrote.
  const baseMethodIdByTargetMethodId = new Map<string, string>(
    bomTargets.flatMap(
      (target): Array<[string, string]> =>
        target.baseMethodId ? [[target.methodId, target.baseMethodId]] : []
    )
  );
  const copyTargetMethodIds = [...baseMethodIdByTargetMethodId.entries()]
    .filter(([, baseMethodId]) => copiedKeysByBaseMethodId.has(baseMethodId))
    .map(([targetMethodId]) => targetMethodId);
  const targetMethodIds = bomTargets.map((target) => target.methodId);
  const [copies, mapped] = bomReadFailure
    ? [null, null]
    : await Promise.all([
        selectInBatches(copyTargetMethodIds, (batch) =>
          client
            .from("methodMaterial")
            .select("id, makeMethodId, itemId, order, quantity")
            .eq("companyId", companyId)
            .in("makeMethodId", batch)
        ),
        selectInBatches(targetMethodIds, (batch) =>
          serviceRole
            .from("externalIntegrationMapping")
            .select("id, entityId")
            .eq("companyId", companyId)
            .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
            .eq("entityType", "methodMaterial")
            .in("metadata->>makeMethodId", batch)
        )
      ]);
  if (!bomReadFailure && (copies?.error || mapped?.error)) {
    bomReadFailure =
      (copies?.error ?? mapped?.error)?.message ?? "failed to read BOM lines";
  }

  if (bomReadFailure) {
    const carriesCopies = created.some((entry) => {
      const baseMethod = entry.baseItemId
        ? baseMethodByItemId.get(entry.baseItemId)
        : undefined;
      return !!baseMethod && copiedKeysByBaseMethodId.has(baseMethod.id);
    });
    summary.errors.push(
      `The released BOMs were not written: Carbon couldn't read what they replace (${bomReadFailure}). Push the release again.${
        carriesCopies
          ? " A revision this push created still carries its base revision's lines — check its bill of materials before pushing again."
          : ""
      }`
    );
    bomTargets.length = 0;
  }

  const toDelete = (copies?.data ?? [])
    .filter((line) => {
      const baseMethodId = baseMethodIdByTargetMethodId.get(line.makeMethodId);
      return (
        !!baseMethodId &&
        copiedKeysByBaseMethodId.get(baseMethodId)?.has(lineKey(line))
      );
    })
    .map((line) => line.id);
  for (const batch of bomReadFailure ? [] : chunkFilterValues(toDelete)) {
    const deduped = await client
      .from("methodMaterial")
      .delete()
      .eq("companyId", companyId)
      .in("id", batch);
    if (deduped.error) {
      summary.errors.push(
        `Could not remove the lines copied from the base revisions (${deduped.error.message}); released BOMs may contain duplicates`
      );
    }
  }

  if (mapped && !bomReadFailure) {
    // A line whose delete failed keeps its ownership row, or it would read as manual.
    const failedLineIds = new Set<string>();
    for (const batch of chunkFilterValues(
      mapped.data.map((mapping) => mapping.entityId)
    )) {
      const removedLines = await client
        .from("methodMaterial")
        .delete()
        .eq("companyId", companyId)
        .in("id", batch);
      if (removedLines.error) {
        for (const id of batch) failedLineIds.add(id);
        summary.errors.push(
          `Could not replace the lines a previous release push wrote (${removedLines.error.message}); this push may add a second copy of them`
        );
      }
    }
    for (const batch of chunkFilterValues(
      mapped.data
        .filter((mapping) => !failedLineIds.has(mapping.entityId))
        .map((mapping) => mapping.id)
    )) {
      const removedMappings = await serviceRole
        .from("externalIntegrationMapping")
        .delete()
        .eq("companyId", companyId)
        .in("id", batch);
      if (removedMappings.error) {
        summary.errors.push(
          `Could not clear the ownership records for the replaced released lines (${removedMappings.error.message})`
        );
      }
    }
  }
  summary.methodsTouched += bomTargets.length;

  // 2d: write the released lines. Level 1 only; sub-assemblies get theirs from their own entries.
  for (const target of bomTargets) {
    const { item, label, methodId } = target;
    const lines: OwnedMethodLine[] = [];
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
        child.children.length > 0 ||
        childItem.defaultMethodType === "Make to Order"
          ? methodByItemId.get(childItem.id)
          : null;
      lines.push({
        row: {
          itemId: childItem.id,
          quantity: child.quantity,
          makeMethodId: methodId,
          materialMakeMethodId: childMethod?.id ?? null,
          methodType:
            (childItem.defaultMethodType as OwnedMethodLine["row"]["methodType"]) ??
            (child.children.length > 0
              ? "Make to Order"
              : "Pull from Inventory"),
          sourcingType:
            (childItem.sourcingType as OwnedMethodLine["row"]["sourcingType"]) ??
            "Specified",
          order: lines.length,
          itemType,
          unitOfMeasureCode: childItem.unitOfMeasureCode ?? "EA"
        },
        metadata: {
          makeMethodId: methodId,
          documentId: plan.documentId,
          elementId: item.elementId,
          partNumber: child.partNumber,
          index: child.index,
          releaseId: plan.releaseId
        }
      });
    }
    const written = await insertOwnedMethodLines(db, {
      companyId,
      userId,
      lines
    });
    if (written.error !== null) {
      summary.errors.push(
        `${label}: the released BOM lines were not written (${written.error}); push the release again`
      );
    } else {
      summary.linesWritten += lines.length;
    }
  }

  // Pass 3: release mappings and default revisions.
  // An item holds one Onshape link. A reused revision already linked to its
  // part or assembly keeps that link, which status and change detection read.
  const reusedIds = decisions
    .filter((decision) => decision.kind === "reuse")
    .map((decision) => decision.row.id);
  const keepsLink = new Set<string>();
  if (reusedIds.length > 0) {
    const links = await selectInBatches(reusedIds, (batch) =>
      serviceRole
        .from("externalIntegrationMapping")
        .select("entityId, externalId")
        .eq("companyId", companyId)
        .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
        .eq("entityType", "item")
        .in("entityId", batch)
    );
    if (links.error) {
      for (const id of reusedIds) keepsLink.add(id);
      summary.errors.push(
        `Could not read the Onshape links of existing revisions (${links.error.message}); they keep their current links`
      );
    } else {
      for (const link of links.data) {
        if (!link.externalId?.startsWith("release:")) {
          keepsLink.add(link.entityId);
        }
      }
    }
  }
  for (const item of modelItems) {
    const row = revisionItemByPartNumber.get(item.partNumber);
    if (!row || keepsLink.has(row.id)) continue;
    const externalId = `release:${plan.releaseId}:${item.partNumber}`;
    const pushedAt = datetime.timestamp();
    const releaseMapping = await swapItemMapping(db, {
      companyId,
      userId,
      itemId: row.id,
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
      }
    });
    if (releaseMapping.error !== null) {
      summary.errors.push(
        `${item.partNumber} Rev ${item.revision}: revision written but not linked to Onshape (${releaseMapping.error}); it is invisible to change detection and to Detach`
      );
    }
  }

  // Make Default repoints sibling revisions' methodMaterial lines to the new revision.
  // A staged revision is left out: until its notice is released it is inactive,
  // and the release supersedes the old revision instead.
  if (makeDefault && !changeNotice) {
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

  // Pass 4: asset exports at the released versions.
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
    // The model the plan tied the drawing to: in this release, or already in
    // Carbon at the revision the release package names.
    const model = drawing.drawingOf;
    const targetId = model
      ? (revisionItemByPartNumber.get(model.partNumber)?.id ??
        model.itemId ??
        null)
      : null;
    if (!targetId) {
      summary.skipped.push(
        model
          ? `${drawing.partNumber}: drawing waits for ${model.partNumber}${
              model.revision ? ` Rev ${model.revision}` : ""
            }, which isn't in Carbon; push its release first`
          : `${drawing.partNumber}: drawing has no matching model item in this release`
      );
      continue;
    }
    assetTargets.push({ item: drawing, itemId: targetId, kind: "drawing" });
  }
  for (const target of assetTargets) {
    const selection: ReleaseExportSelection =
      target.kind === "drawing"
        ? { ok: true }
        : releaseExportSelection(target.item);
    if (!selection.ok) {
      summary.skipped.push(
        `${target.item.partNumber} Rev ${target.item.revision}: ${selection.reason}`
      );
      continue;
    }
    // The event id dedupes a retried apply; the job spends Onshape quota on every run.
    // Per-target try: the writes have landed, so a queue failure is a partial success.
    try {
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
          ...(selection.partId ? { partId: selection.partId } : {}),
          ...(selection.configuration
            ? { configuration: selection.configuration }
            : {}),
          assetBaseName: `${target.item.partNumber}-${target.item.revision}`
        },
        { id: `${planId}:${target.itemId}:${target.item.elementId}` }
      );
      if (target.kind === "drawing") summary.drawingsQueued += 1;
    } catch {
      summary.errors.push(
        `${target.item.partNumber} Rev ${target.item.revision}: pushed, but the ${
          target.kind === "drawing" ? "drawing" : "model"
        } export couldn't be queued. Push again to retry the export.`
      );
    }
  }

  return data({ summary }, { headers: { "Cache-Control": "no-store" } });
}
