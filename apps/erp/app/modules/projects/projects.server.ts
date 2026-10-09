// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { toJson } from "@carbon/database/json";
import { getLogger } from "@carbon/logger";
import { serverFns } from "@carbon/server-functions";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { customAlphabet } from "nanoid";
import { data } from "react-router";
import type { z } from "zod";
import { getMethodTree } from "~/modules/items/items.service";
import { getDatabaseClient } from "~/services/database.server";
import type {
  BuildSourceNode,
  BuildTraceRow,
  ChangeOperationMark,
  ChangeRequestChange,
  ChangeRequestConflict,
  ChangeRequestItem,
  ElementVerification,
  logTimeValidator,
  PlannedBuildElement,
  PlanRow,
  ProjectBaselineSource,
  ProjectChangeOperation,
  ProjectChangeRequestStatus,
  ProjectCopyElement,
  ProjectCopySource,
  ProjectElementEditableField,
  ProjectElementType,
  ProjectPlanSnapshot,
  ProjectPlanTable,
  ProjectStateGroup,
  projectElementLinkValidator,
  projectElementValidator,
  projectIssueValidator,
  projectValidator,
  RequirementStatus,
  VerificationElement
} from "./projects.models";
import {
  applyChangeRequestItems,
  BUILD_FROM_PART_MAX_NODES,
  canLink,
  chargeableByDefault,
  computeVerification,
  defaultProjectStates,
  diffPlanSnapshots,
  findConflicts,
  isProjectPlanLocked,
  mergeChangeRequestItem,
  netBuildComponents,
  overlayPlanRows,
  PLAN_LAYER_FIELDS,
  PROJECT_BASELINE_FORMAT_VERSION,
  parseElementPlanFieldValue,
  parseParameterFormula,
  parsePlanSnapshot,
  pickPlanLayerFields,
  planElementsFromSource,
  planProjectCopy,
  planRowParentIds,
  planSnapshotKeys,
  projectCopyIdPrefixes,
  projectPlanLockedMessage,
  rebaseChangeRequestItems,
  rollUpRequirementStatus,
  toPlanSnapshot,
  typeSpecificElementFields
} from "./projects.models";
import {
  getElementHistoryByItem,
  getItemNumericCustomFields,
  getLaborCategoriesList,
  getLaborCategoryNames,
  getProjectBaseline,
  getProjectChangeRequest,
  getProjectCostSummary,
  getProjectElement,
  getProjectElementComments,
  getProjectElementLinks,
  getProjectElementPlanLines,
  getProjectElements,
  getProjectItemValues
} from "./projects.service";
import type { ProjectElementLink } from "./types";

/**
 * Creates a project with its six default states, in one transaction. A new
 * project starts in Draft, so nothing can charge it before it is released.
 * When `identifier` is empty, the SQL function `derive_project_identifier`
 * picks a unique one from the name.
 */
export async function createProject(
  db: Kysely<KyselyDatabase>,
  args: Omit<z.infer<typeof projectValidator>, "id"> & {
    companyId: string;
    userId: string;
  }
): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const project = await trx
      .insertInto("project")
      .values({
        name: args.name,
        identifier: args.identifier
          ? args.identifier
          : sql<string>`derive_project_identifier(${args.name}, ${args.companyId})`,
        description: args.description ?? null,
        status: "Draft",
        costTreatment: args.costTreatment,
        costAccountId: args.costAccountId ?? null,
        fixedAssetClassId: args.fixedAssetClassId ?? null,
        customerId: args.customerId ?? null,
        ownerId: args.ownerId ?? null,
        locationId: args.locationId ?? null,
        startDate: args.startDate ?? null,
        endDate: args.endDate ?? null,
        priority: args.priority ?? "None",
        active: true,
        companyId: args.companyId,
        createdBy: args.userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("projectState")
      .values(
        defaultProjectStates.map((state) => ({
          projectId: project.id,
          companyId: args.companyId,
          name: state.name,
          group: state.group,
          color: state.color,
          sortOrder: state.sortOrder,
          isDefault: state.isDefault,
          createdBy: args.userId
        }))
      )
      .execute();

    return project.id;
  });
}

/** A new row id with the prefix the SQL `id()` default would give it. */
const makeCopyId = (() => {
  const base58 = customAlphabet(
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",
    22
  );
  return (prefix: string) => `${prefix}_${base58()}`;
})();

/**
 * Creates a Draft project as a copy of another project of the company, in
 * one transaction: its states, labels, milestones, elements (renumbered from
 * 1), element labels, links and plan lines. Charges, ledger rows, timesheets,
 * comments, views, preferences and assets are not copied. When `identifier`
 * is empty, `derive_project_identifier` picks one from the name.
 */
export async function copyProject(
  db: Kysely<KyselyDatabase>,
  args: Omit<z.infer<typeof projectValidator>, "id"> & {
    companyId: string;
    userId: string;
    sourceProjectId: string;
  }
): Promise<string> {
  const { companyId, userId, sourceProjectId } = args;
  return db.transaction().execute(async (trx) => {
    const sourceProject = await trx
      .selectFrom("project")
      .select("id")
      .where("id", "=", sourceProjectId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!sourceProject) {
      throw new Error("The project to copy from was not found");
    }

    const ofSource = <
      T extends
        | "projectState"
        | "projectLabel"
        | "projectMilestone"
        | "projectElement"
        | "projectElementLink"
        | "projectElementMaterial"
        | "projectElementLabor"
        | "projectElementCost"
    >(
      table: T
    ) =>
      trx
        .selectFrom(table as "projectState")
        .selectAll()
        .where("projectId", "=", sourceProjectId)
        .where("companyId", "=", companyId)
        .execute();

    const [
      states,
      labels,
      milestones,
      elements,
      links,
      materials,
      labor,
      costs,
      elementLabels,
      identifierRow
    ] = await Promise.all([
      ofSource("projectState"),
      ofSource("projectLabel"),
      ofSource("projectMilestone"),
      ofSource("projectElement"),
      ofSource("projectElementLink"),
      ofSource("projectElementMaterial"),
      ofSource("projectElementLabor"),
      ofSource("projectElementCost"),
      trx
        .selectFrom("projectElementLabel as el")
        .innerJoin("projectElement as e", (join) =>
          join
            .onRef("e.id", "=", "el.projectElementId")
            .onRef("e.companyId", "=", "el.companyId")
        )
        .select(["el.projectElementId", "el.projectLabelId"])
        .where("e.projectId", "=", sourceProjectId)
        .where("el.companyId", "=", companyId)
        .execute(),
      args.identifier
        ? Promise.resolve({ identifier: args.identifier })
        : sql<{
            identifier: string;
          }>`SELECT derive_project_identifier(${args.name}, ${companyId}) AS "identifier"`
            .execute(trx)
            .then((result) => result.rows[0]!)
    ]);

    const projectId = makeCopyId("prj");
    const plan = planProjectCopy(
      {
        states,
        labels,
        milestones,
        elements: elements as unknown as ProjectCopyElement[],
        elementLabels,
        links: links as unknown as ProjectCopySource["links"],
        materials: materials as unknown as ProjectCopySource["materials"],
        labor: labor as unknown as ProjectCopySource["labor"],
        costs: costs as unknown as ProjectCopySource["costs"]
      },
      projectId,
      identifierRow.identifier,
      makeCopyId
    );

    await trx
      .insertInto("project")
      .values({
        id: projectId,
        name: args.name,
        identifier: identifierRow.identifier,
        description: args.description ?? null,
        status: "Draft",
        costTreatment: args.costTreatment,
        costAccountId: args.costAccountId ?? null,
        fixedAssetClassId: args.fixedAssetClassId ?? null,
        customerId: args.customerId ?? null,
        ownerId: args.ownerId ?? null,
        locationId: args.locationId ?? null,
        startDate: args.startDate ?? null,
        endDate: args.endDate ?? null,
        priority: args.priority ?? "None",
        nextElementSequence: plan.nextElementSequence,
        active: true,
        companyId,
        createdBy: userId
      })
      .execute();

    // FK order: states, labels and milestones before the elements that
    // point at them; elements (parents first) before labels, links and plan
    // lines. Every row of one insert has the same keys.
    const audit = { companyId, createdBy: userId };
    const insertRows = async (table: string, rows: object[]) => {
      if (rows.length === 0) return;
      await trx
        .insertInto(table as "projectState")
        .values(rows.map((row) => ({ ...row, ...audit })) as never)
        .execute();
    };
    await insertRows("projectState", plan.states);
    await insertRows("projectLabel", plan.labels);
    await insertRows("projectMilestone", plan.milestones);
    await insertRows("projectElement", plan.elements);
    await insertRows("projectElementLabel", plan.elementLabels);
    await insertRows("projectElementLink", plan.links);
    await insertRows("projectElementMaterial", plan.materials);
    await insertRows("projectElementLabor", plan.labor);
    await insertRows("projectElementCost", plan.costs);

    return projectId;
  });
}

// --- Baselines (Phase 1c) -------------------------------------------------------

/**
 * Loads the plan layer of a project as a snapshot: 5 queries, one per plan
 * table, each reading only its `PLAN_LAYER_FIELDS`.
 */
export async function loadPlanSnapshot(
  db: Kysely<KyselyDatabase> | KyselyTx,
  args: { companyId: string; projectId: string }
): Promise<ProjectPlanSnapshot> {
  const ofProject = (table: ProjectPlanTable) =>
    db
      .selectFrom(table as "projectElement")
      .select(PLAN_LAYER_FIELDS[table] as never)
      .where("projectId", "=", args.projectId)
      .where("companyId", "=", args.companyId)
      .execute() as Promise<Record<string, unknown>[]>;

  const [elements, links, materials, labor, costs] = await Promise.all([
    ofProject("projectElement"),
    ofProject("projectElementLink"),
    ofProject("projectElementMaterial"),
    ofProject("projectElementLabor"),
    ofProject("projectElementCost")
  ]);
  return toPlanSnapshot({ elements, links, materials, labor, costs });
}

export type CreateProjectBaselineArgs = {
  companyId: string;
  userId: string;
  projectId: string;
  name: string;
  source: ProjectBaselineSource;
  milestoneId?: string | null;
  changeRequestId?: string | null;
};

/**
 * Writes a baseline inside an open transaction: takes the next
 * `project.nextBaselineSequence` (the UPDATE locks the project row), loads the
 * snapshot and inserts it with its counts. The change request apply reuses it.
 */
export async function insertProjectBaseline(
  trx: KyselyTx,
  args: CreateProjectBaselineArgs
): Promise<{ id: string; sequence: number }> {
  const project = await trx
    .updateTable("project")
    .set({ nextBaselineSequence: sql`"nextBaselineSequence" + 1` })
    .where("id", "=", args.projectId)
    .where("companyId", "=", args.companyId)
    .returning(sql<number>`"nextBaselineSequence" - 1`.as("sequence"))
    .executeTakeFirst();
  if (!project) throw new Error("The project does not exist");

  const snapshot = await loadPlanSnapshot(trx, args);
  const baseline = await trx
    .insertInto("projectBaseline")
    .values({
      companyId: args.companyId,
      projectId: args.projectId,
      sequence: project.sequence,
      name: args.name,
      source: args.source,
      milestoneId: args.milestoneId ?? null,
      changeRequestId: args.changeRequestId ?? null,
      formatVersion: PROJECT_BASELINE_FORMAT_VERSION,
      snapshot: toJson(snapshot) as never,
      elementCount: snapshot.elements.length,
      linkCount: snapshot.links.length,
      createdBy: args.userId
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return { id: baseline.id, sequence: project.sequence };
}

/** Takes a baseline of a project's plan layer, in one transaction. */
export async function createProjectBaseline(
  db: Kysely<KyselyDatabase>,
  args: CreateProjectBaselineArgs
): Promise<{ id: string; sequence: number }> {
  return db.transaction().execute((trx) => insertProjectBaseline(trx, args));
}

// --- Change requests (Phase 1c) -------------------------------------------------

/** A refusal a change request write raises; the route shows its message. */
export class ProjectChangeRequestError extends Error {
  status = 422;
}

/**
 * The change request a plan-layer write goes to: the form field
 * `changeRequestId`, else `?cr=` on the action URL. Null writes live.
 */
export function readChangeRequestId(request: Request, formData: FormData) {
  const field = formData.get("changeRequestId");
  if (typeof field === "string" && field) return field;
  return new URL(request.url).searchParams.get("cr") || null;
}

export type ChangeRequestItemRow = ChangeRequestItem & {
  id: string;
  createdAt: string;
  updatedAt: string | null;
};

function itemKey(table: string, id: string) {
  return `${table}:${id}`;
}

function toChangeRequestItem(row: {
  id: string;
  operation: ProjectChangeOperation;
  targetTable: ProjectPlanTable;
  targetId: string;
  payload: unknown;
  baseRow: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}): ChangeRequestItemRow {
  const asRecord = (value: unknown) =>
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  const asText = (value: unknown) =>
    value == null
      ? null
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  return {
    id: row.id,
    operation: row.operation,
    targetTable: row.targetTable,
    targetId: row.targetId,
    payload: asRecord(row.payload),
    baseRow: asRecord(row.baseRow),
    createdAt: asText(row.createdAt) ?? "",
    updatedAt: asText(row.updatedAt)
  };
}

/** The items of a change request, oldest first. */
export async function loadChangeRequestItems(
  db: Kysely<KyselyDatabase> | KyselyTx,
  args: { companyId: string; changeRequestId: string }
): Promise<ChangeRequestItemRow[]> {
  const rows = await db
    .selectFrom("projectChangeRequestItem")
    .select([
      "id",
      "operation",
      "targetTable",
      "targetId",
      "payload",
      "baseRow",
      "createdAt",
      "updatedAt"
    ])
    .where("changeRequestId", "=", args.changeRequestId)
    .where("companyId", "=", args.companyId)
    .orderBy("createdAt", "asc")
    .orderBy("id", "asc")
    .execute();
  return rows.map(toChangeRequestItem);
}

/**
 * A change request with its items, the live plan and the plan as the change
 * request would leave it. Null when it is not a change request of the
 * project.
 */
export async function loadChangeRequestOverlay(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; projectId: string; changeRequestId: string }
) {
  const [changeRequest, items, live] = await Promise.all([
    db
      .selectFrom("projectChangeRequest")
      .select(["id", "projectId", "readableId", "title", "status"])
      .where("id", "=", args.changeRequestId)
      .where("companyId", "=", args.companyId)
      .executeTakeFirst(),
    loadChangeRequestItems(db, args),
    loadPlanSnapshot(db, args)
  ]);
  if (!changeRequest || changeRequest.projectId !== args.projectId) {
    return null;
  }
  return {
    changeRequest,
    items,
    live,
    overlay: applyChangeRequestItems(live, items)
  };
}

export type ChangeRequestOverlay = NonNullable<
  Awaited<ReturnType<typeof loadChangeRequestOverlay>>
>;

/**
 * Writes changes into a Draft change request, in one transaction. Each change
 * folds into the item of its row (`mergeChangeRequestItem`). Deleting an
 * element the change request added also drops the rows it added under that
 * element. Refuses unless the change request is a Draft of the project.
 */
export async function upsertChangeRequestItems(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    projectId: string;
    changeRequestId: string;
    changes: ChangeRequestChange[];
  }
) {
  return db.transaction().execute(async (trx) => {
    const changeRequest = await trx
      .selectFrom("projectChangeRequest")
      .select(["projectId", "status", "readableId"])
      .where("id", "=", args.changeRequestId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!changeRequest || changeRequest.projectId !== args.projectId) {
      throw new ProjectChangeRequestError("The change request does not exist");
    }
    if (changeRequest.status !== "Draft") {
      throw new ProjectChangeRequestError(
        `${changeRequest.readableId} is ${changeRequest.status}. Only a Draft change request takes changes.`
      );
    }

    const existing = await loadChangeRequestItems(trx, args);
    const items = new Map<string, ChangeRequestItem & { rowId?: string }>(
      existing.map((item) => [
        itemKey(item.targetTable, item.targetId),
        { ...item, rowId: item.id }
      ])
    );

    // The live rows a change touches for the first time: one query per table.
    const firstTouch = new Map<ProjectPlanTable, Set<string>>();
    for (const change of args.changes) {
      if (change.operation === "Add") continue;
      if (items.has(itemKey(change.targetTable, change.targetId))) continue;
      const ids = firstTouch.get(change.targetTable) ?? new Set<string>();
      ids.add(change.targetId);
      firstTouch.set(change.targetTable, ids);
    }
    const liveRows = new Map<string, Record<string, unknown>>();
    await Promise.all(
      [...firstTouch.entries()].map(async ([table, ids]) => {
        const rows = (await trx
          .selectFrom(table as "projectElement")
          .select(PLAN_LAYER_FIELDS[table] as never)
          .where("id", "in", [...ids])
          .where("projectId", "=", args.projectId)
          .where("companyId", "=", args.companyId)
          .execute()) as Record<string, unknown>[];
        for (const row of rows) {
          liveRows.set(itemKey(table, row.id as string), row);
        }
      })
    );

    const removedAddedElements = new Set<string>();
    const changedKeys = new Set<string>();
    const deletedRowIds: string[] = [];
    for (const change of args.changes) {
      const key = itemKey(change.targetTable, change.targetId);
      const current = items.get(key) ?? null;
      const merged = mergeChangeRequestItem(
        current,
        change,
        liveRows.get(key) ?? null
      );
      if ("error" in merged) throw new ProjectChangeRequestError(merged.error);
      if (merged.item) {
        items.set(key, { ...merged.item, rowId: current?.rowId });
        changedKeys.add(key);
        continue;
      }
      if (!current) continue;
      items.delete(key);
      changedKeys.delete(key);
      if (current.rowId) deletedRowIds.push(current.rowId);
      if (
        current.operation === "Add" &&
        current.targetTable === "projectElement"
      ) {
        removedAddedElements.add(current.targetId);
      }
    }

    // Rows the change request added under a removed added element go too.
    let dropped = removedAddedElements.size > 0;
    while (dropped) {
      dropped = false;
      for (const [key, item] of items) {
        if (item.operation !== "Add") continue;
        const parents = planRowParentIds(item.targetTable, item.payload ?? {});
        if (!parents.some((id) => removedAddedElements.has(id))) continue;
        items.delete(key);
        changedKeys.delete(key);
        if (item.rowId) deletedRowIds.push(item.rowId);
        if (item.targetTable === "projectElement") {
          removedAddedElements.add(item.targetId);
          dropped = true;
        }
      }
    }
    for (const item of items.values()) {
      const parents = planRowParentIds(item.targetTable, item.payload ?? {});
      if (parents.some((id) => removedAddedElements.has(id))) {
        throw new ProjectChangeRequestError(
          "A change in this change request still uses the element. Change it first."
        );
      }
    }

    if (deletedRowIds.length > 0) {
      await trx
        .deleteFrom("projectChangeRequestItem")
        .where("id", "in", deletedRowIds)
        .where("companyId", "=", args.companyId)
        .execute();
    }
    const upserts = [...changedKeys].map((key) => items.get(key)!);
    if (upserts.length > 0) {
      await trx
        .insertInto("projectChangeRequestItem")
        .values(
          upserts.map((item) => ({
            companyId: args.companyId,
            changeRequestId: args.changeRequestId,
            operation: item.operation,
            targetTable: item.targetTable,
            targetId: item.targetId,
            payload: (item.payload ? toJson(item.payload) : null) as never,
            baseRow: (item.baseRow ? toJson(item.baseRow) : null) as never,
            createdBy: args.userId
          }))
        )
        .onConflict((oc) =>
          oc
            .columns([
              "changeRequestId",
              "targetTable",
              "targetId",
              "companyId"
            ])
            .doUpdateSet((eb) => ({
              operation: eb.ref("excluded.operation"),
              payload: eb.ref("excluded.payload"),
              baseRow: eb.ref("excluded.baseRow"),
              updatedBy: args.userId,
              updatedAt: sql`NOW()`
            }))
        )
        .execute();
    }
    await trx
      .updateTable("projectChangeRequest")
      .set({ updatedBy: args.userId, updatedAt: sql`NOW()` })
      .where("id", "=", args.changeRequestId)
      .where("companyId", "=", args.companyId)
      .execute();
  });
}

function overlayElement(overlay: ChangeRequestOverlay, id: string | null) {
  return id ? overlay.overlay.elements.find((row) => row.id === id) : undefined;
}

function nextSortOrder(overlay: ChangeRequestOverlay, parentId: string | null) {
  const siblings = overlay.overlay.elements.filter(
    (row) => ((row.parentId as string | null) ?? null) === parentId
  );
  return (
    siblings.reduce(
      (max, row) => Math.max(max, Number(row.sortOrder ?? 0)),
      0
    ) + 1
  );
}

async function requireOverlay(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; projectId: string; changeRequestId: string }
) {
  const overlay = await loadChangeRequestOverlay(db, args);
  if (!overlay) {
    throw new ProjectChangeRequestError("The change request does not exist");
  }
  return overlay;
}

type ChangeRequestWriteArgs = {
  companyId: string;
  userId: string;
  projectId: string;
  changeRequestId: string;
};

/**
 * Adds an element to a change request. Its id is made now and kept; its
 * readable id stays empty until the apply step numbers it. An empty state
 * takes the default Unstarted state, as `insertProjectElement` does.
 */
export async function addElementToChangeRequest(
  db: Kysely<KyselyDatabase>,
  args: ChangeRequestWriteArgs & {
    element: Omit<z.infer<typeof projectElementValidator>, "id">;
  }
) {
  const overlay = await requireOverlay(db, args);
  const { element } = args;
  const parentId = element.parentId ?? null;
  if (parentId) {
    const parent = overlayElement(overlay, parentId);
    if (!parent)
      throw new ProjectChangeRequestError("The parent element does not exist");
    if (parent.type === "Parameter" && element.type !== "Parameter") {
      throw new ProjectChangeRequestError(
        "A Parameter can only have Parameters as children"
      );
    }
  }

  let stateId = element.stateId ?? null;
  if (!stateId) {
    const state = await db
      .selectFrom("projectState")
      .select("id")
      .where("projectId", "=", args.projectId)
      .where("companyId", "=", args.companyId)
      .where("group", "=", "Unstarted")
      .orderBy("isDefault", "desc")
      .orderBy("sortOrder", "asc")
      .limit(1)
      .executeTakeFirst();
    if (!state)
      throw new ProjectChangeRequestError("The project has no Unstarted state");
    stateId = state.id;
  }

  const id = makeCopyId(projectCopyIdPrefixes.element);
  await upsertChangeRequestItems(db, {
    ...args,
    changes: [
      {
        operation: "Add",
        targetTable: "projectElement",
        targetId: id,
        payload: {
          projectId: args.projectId,
          parentId,
          readableId: "",
          sortOrder: nextSortOrder(overlay, parentId),
          type: element.type,
          name: element.name,
          stateId,
          ownerId: element.ownerId ?? null,
          priority: element.priority ?? "None",
          milestoneId: element.milestoneId ?? null,
          startDate: element.startDate ?? null,
          targetDate: element.targetDate ?? null,
          estimatedHours: element.estimatedHours ?? null,
          isChargeable:
            element.type === "Parameter"
              ? false
              : (element.isChargeable ?? chargeableByDefault[element.type]),
          budget: element.budget ?? null,
          itemId: element.itemId ?? null
        }
      }
    ]
  });
  return { id, readableId: "" };
}

/**
 * Sets one plan-layer field on elements in a change request. The value is
 * parsed as the live update parses it, and a type-specific field is refused on
 * an element of another type.
 */
export async function updateElementFieldInChangeRequest(
  db: Kysely<KyselyDatabase>,
  args: ChangeRequestWriteArgs & {
    ids: string[];
    field: ProjectElementEditableField;
    value: string | null | undefined;
  }
) {
  const raw = args.value === undefined || args.value === "" ? null : args.value;
  const parsed = parseElementPlanFieldValue(args.field, raw);
  if ("error" in parsed) throw new ProjectChangeRequestError(parsed.error);

  const overlay = await requireOverlay(db, args);
  const elements = args.ids.map((id) => {
    const row = overlayElement(overlay, id);
    if (!row) throw new ProjectChangeRequestError("The element does not exist");
    return row;
  });
  const requiredType = typeSpecificElementFields[args.field];
  const other = requiredType
    ? elements.find((row) => row.type !== requiredType)
    : undefined;
  if (other) {
    throw new ProjectChangeRequestError(
      `${other.readableId || other.name} is a ${other.type}, not a ${requiredType}`
    );
  }
  const parameter = elements.find((row) => row.type === "Parameter");
  if (parameter && args.field === "isChargeable" && parsed.value === true) {
    throw new ProjectChangeRequestError("A Parameter cannot take charges");
  }
  if (
    parameter &&
    (args.field === "itemId" || args.field === "trackedEntityId") &&
    parsed.value !== null
  ) {
    throw new ProjectChangeRequestError("A Parameter cannot link a part");
  }

  const payload: Record<string, unknown> = { [args.field]: parsed.value };
  // A new part drops the serial of the old one.
  if (args.field === "itemId") payload.trackedEntityId = null;
  await upsertChangeRequestItems(db, {
    ...args,
    changes: args.ids.map((id) => ({
      operation: "Update" as const,
      targetTable: "projectElement" as const,
      targetId: id,
      payload
    }))
  });
}

/**
 * Moves an element in a change request, after its new last sibling. Refuses
 * a parent in its own subtree and a Parameter parent for another type.
 */
export async function moveElementInChangeRequest(
  db: Kysely<KyselyDatabase>,
  args: ChangeRequestWriteArgs & { elementId: string; parentId: string | null }
) {
  const overlay = await requireOverlay(db, args);
  const element = overlayElement(overlay, args.elementId);
  if (!element)
    throw new ProjectChangeRequestError("The element does not exist");
  if (args.parentId) {
    const parent = overlayElement(overlay, args.parentId);
    if (!parent)
      throw new ProjectChangeRequestError("The parent element does not exist");
    let current: PlanRow | undefined = parent;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      if (current.id === args.elementId) {
        throw new ProjectChangeRequestError(
          "An element cannot move under itself or one of its descendants"
        );
      }
      seen.add(current.id);
      current = overlayElement(overlay, current.parentId as string | null);
    }
    if (parent.type === "Parameter" && element.type !== "Parameter") {
      throw new ProjectChangeRequestError(
        "A Parameter can only have Parameters as children"
      );
    }
  }
  await upsertChangeRequestItems(db, {
    ...args,
    changes: [
      {
        operation: "Update",
        targetTable: "projectElement",
        targetId: args.elementId,
        payload: {
          parentId: args.parentId,
          sortOrder: nextSortOrder(overlay, args.parentId)
        }
      }
    ]
  });
}

/** Saves a drag-sort order of sibling elements in a change request. */
export async function orderElementsInChangeRequest(
  db: Kysely<KyselyDatabase>,
  args: ChangeRequestWriteArgs & {
    updates: { id: string; sortOrder: number }[];
  }
) {
  await upsertChangeRequestItems(db, {
    ...args,
    changes: args.updates.map((update) => ({
      operation: "Update" as const,
      targetTable: "projectElement" as const,
      targetId: update.id,
      payload: { sortOrder: update.sortOrder }
    }))
  });
}

/** Deletes an element (with its subtree) in a change request. */
export async function deleteElementInChangeRequest(
  db: Kysely<KyselyDatabase>,
  args: ChangeRequestWriteArgs & { elementId: string }
) {
  await upsertChangeRequestItems(db, {
    ...args,
    changes: [
      {
        operation: "Delete",
        targetTable: "projectElement",
        targetId: args.elementId,
        payload: null
      }
    ]
  });
}

/** Adds a trace link in a change request; `canLink` checks the overlaid plan. */
export async function addLinkToChangeRequest(
  db: Kysely<KyselyDatabase>,
  args: ChangeRequestWriteArgs & {
    link: z.infer<typeof projectElementLinkValidator>;
  }
) {
  const overlay = await requireOverlay(db, args);
  const from = overlayElement(overlay, args.link.fromElementId);
  const to = overlayElement(overlay, args.link.toElementId);
  if (!from || !to) {
    throw new ProjectChangeRequestError(
      "Both elements must be in this project"
    );
  }
  const check = canLink(
    { id: from.id, type: from.type as ProjectElementType },
    { id: to.id, type: to.type as ProjectElementType },
    args.link.linkType,
    overlay.overlay.links as unknown as Parameters<typeof canLink>[3]
  );
  if (!check.ok) throw new ProjectChangeRequestError(check.reason);

  const id = makeCopyId(projectCopyIdPrefixes.link);
  await upsertChangeRequestItems(db, {
    ...args,
    changes: [
      {
        operation: "Add",
        targetTable: "projectElementLink",
        targetId: id,
        payload: { projectId: args.projectId, ...args.link }
      }
    ]
  });
  return { id };
}

/** Deletes a trace link in a change request. A `feeds` link is refused. */
export async function deleteLinkInChangeRequest(
  db: Kysely<KyselyDatabase>,
  args: ChangeRequestWriteArgs & { linkId: string }
) {
  const overlay = await requireOverlay(db, args);
  const link = overlay.overlay.links.find((row) => row.id === args.linkId);
  if (!link) throw new ProjectChangeRequestError("The link does not exist");
  if (link.linkType === "feeds") {
    throw new ProjectChangeRequestError(
      "A formula writes this link. Edit the formula instead."
    );
  }
  await upsertChangeRequestItems(db, {
    ...args,
    changes: [
      {
        operation: "Delete",
        targetTable: "projectElementLink",
        targetId: args.linkId,
        payload: null
      }
    ]
  });
}

const PLAN_LINE_PREFIXES = {
  projectElementMaterial: projectCopyIdPrefixes.material,
  projectElementLabor: projectCopyIdPrefixes.labor,
  projectElementCost: projectCopyIdPrefixes.cost
} as const;

export type PlanLineTable = keyof typeof PLAN_LINE_PREFIXES;

/**
 * Adds (no `id`) or updates a plan line of an element in a change request.
 * `fields` are the line's validated plan-layer columns.
 */
export async function upsertPlanLineInChangeRequest(
  db: Kysely<KyselyDatabase>,
  args: ChangeRequestWriteArgs & {
    table: PlanLineTable;
    id?: string;
    elementId: string;
    fields: Record<string, unknown>;
  }
) {
  const overlay = await requireOverlay(db, args);
  if (!overlayElement(overlay, args.elementId)) {
    throw new ProjectChangeRequestError("The element does not exist");
  }
  const id = args.id ?? makeCopyId(PLAN_LINE_PREFIXES[args.table]);
  await upsertChangeRequestItems(db, {
    ...args,
    changes: [
      {
        operation: args.id ? "Update" : "Add",
        targetTable: args.table,
        targetId: id,
        payload: {
          ...args.fields,
          projectId: args.projectId,
          projectElementId: args.elementId
        }
      }
    ]
  });
  return { id };
}

/** Deletes a plan line in a change request. */
export async function deletePlanLineInChangeRequest(
  db: Kysely<KyselyDatabase>,
  args: ChangeRequestWriteArgs & { table: PlanLineTable; id: string }
) {
  await upsertChangeRequestItems(db, {
    ...args,
    changes: [
      {
        operation: "Delete",
        targetTable: args.table,
        targetId: args.id,
        payload: null
      }
    ]
  });
}

/** The item ids of each table that a change request updates. */
function updatedIdsOf(items: ChangeRequestItem[], table: ProjectPlanTable) {
  return new Set(
    items
      .filter(
        (item) => item.targetTable === table && item.operation === "Update"
      )
      .map((item) => item.targetId)
  );
}

function liveIdsOf(overlay: ChangeRequestOverlay, table: ProjectPlanTable) {
  return new Set(overlay.live[planSnapshotKeys[table]].map((row) => row.id));
}

function addPayloadsOf(items: ChangeRequestItem[], table: ProjectPlanTable) {
  return new Map(
    items
      .filter((item) => item.targetTable === table && item.operation === "Add")
      .map((item) => [item.targetId, item.payload ?? {}])
  );
}

/**
 * Lays a change request over the element list of a page: changed rows take
 * the overlaid plan-layer fields, added rows are built from their payload
 * with the project's state, and every row carries its `changeOperation`.
 */
export async function overlayElementList<
  T extends { id: string; sortOrder: number | null }
>(
  client: SupabaseClient<Database>,
  overlay: ChangeRequestOverlay,
  rows: T[],
  args: { companyId: string; projectId: string }
) {
  const payloads = addPayloadsOf(overlay.items, "projectElement");
  const stateIds = [
    ...new Set(
      [...payloads.values()]
        .map((payload) => payload.stateId)
        .filter((id): id is string => typeof id === "string")
    )
  ];
  const states =
    stateIds.length > 0
      ? await client
          .from("projectState")
          .select("id, name, group, color")
          .in("id", stateIds)
          .eq("companyId", args.companyId)
      : { data: [], error: null };
  if (states.error) throw states.error;
  const stateById = new Map((states.data ?? []).map((s) => [s.id, s]));

  const merged = overlayPlanRows(
    rows,
    overlay.overlay.elements,
    liveIdsOf(overlay, "projectElement"),
    updatedIdsOf(overlay.items, "projectElement"),
    (row) => {
      const payload = payloads.get(row.id) ?? {};
      return {
        ...payload,
        ...row,
        projectId: args.projectId,
        sequence: 0,
        completedAt: null,
        verdict: null,
        verdictAt: null,
        verdictBy: null,
        createdAt: null,
        updatedAt: null,
        state: stateById.get(payload.stateId as string) ?? null,
        labels: []
      } as unknown as T;
    }
  );
  return merged.sort(
    (a, b) =>
      Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Lays a change request over the links a page loaded. */
export function overlayLinkList<T extends { id: string }>(
  overlay: ChangeRequestOverlay,
  rows: T[]
) {
  return overlayPlanRows(
    rows,
    overlay.overlay.links,
    liveIdsOf(overlay, "projectElementLink"),
    updatedIdsOf(overlay.items, "projectElementLink"),
    (row) =>
      ({
        suspectSince: null,
        reviewedAt: null,
        reviewedBy: null,
        ...row
      }) as unknown as T
  );
}

/**
 * Lays a change request over the plan lines of one element. Added material
 * lines read their item's readable id and name in one query.
 */
export async function overlayPlanLines<
  M extends { id: string },
  L extends { id: string },
  C extends { id: string }
>(
  client: SupabaseClient<Database>,
  overlay: ChangeRequestOverlay,
  planLines: { materials: M[]; labor: L[]; costs: C[] },
  args: { companyId: string; elementId: string }
) {
  const ofElement = (rows: PlanRow[]) =>
    rows.filter((row) => row.projectElementId === args.elementId);
  const materialPayloads = addPayloadsOf(
    overlay.items,
    "projectElementMaterial"
  );
  const itemIds = [
    ...new Set(
      [...materialPayloads.values()]
        .map((payload) => payload.itemId)
        .filter((id): id is string => typeof id === "string")
    )
  ];
  const items =
    itemIds.length > 0
      ? await client
          .from("item")
          .select("id, readableIdWithRevision, name")
          .in("id", itemIds)
          .eq("companyId", args.companyId)
      : { data: [], error: null };
  if (items.error) throw items.error;
  const itemById = new Map((items.data ?? []).map((item) => [item.id, item]));
  const categoryIds = [
    ...new Set(
      [...addPayloadsOf(overlay.items, "projectElementLabor").values()]
        .map((payload) => payload.laborCategoryId)
        .filter((id): id is string => typeof id === "string")
    )
  ];
  const categories =
    categoryIds.length > 0
      ? await client
          .from("laborCategory")
          .select("id, name")
          .in("id", categoryIds)
          .eq("companyId", args.companyId)
      : { data: [], error: null };
  if (categories.error) throw categories.error;
  const categoryById = new Map(
    (categories.data ?? []).map((category) => [category.id, category])
  );

  return {
    materials: overlayPlanRows(
      planLines.materials,
      ofElement(overlay.overlay.materials),
      liveIdsOf(overlay, "projectElementMaterial"),
      updatedIdsOf(overlay.items, "projectElementMaterial"),
      (row) =>
        ({
          ...row,
          quantityIssued: 0,
          jobId: null,
          purchaseOrderLineId: null,
          item: itemById.get(row.itemId as string) ?? null,
          job: null,
          purchaseOrderLine: null
        }) as unknown as M
    ),
    labor: overlayPlanRows(
      planLines.labor,
      ofElement(overlay.overlay.labor),
      liveIdsOf(overlay, "projectElementLabor"),
      updatedIdsOf(overlay.items, "projectElementLabor"),
      (row) =>
        ({
          ...row,
          laborCategory: categoryById.get(row.laborCategoryId as string) ?? null
        }) as unknown as L
    ),
    costs: overlayPlanRows(
      planLines.costs,
      ofElement(overlay.overlay.costs),
      liveIdsOf(overlay, "projectElementCost"),
      updatedIdsOf(overlay.items, "projectElementCost"),
      (row) => ({ ...row }) as unknown as C
    )
  };
}

/**
 * Creates a Draft change request, in one transaction: takes the next
 * `project.nextChangeRequestSequence` for its readable id
 * (`<identifier>-CR-<n>`) and a baseline of the plan it starts from.
 */
export async function createChangeRequest(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    projectId: string;
    title: string;
    reason?: unknown;
  }
): Promise<{ id: string; readableId: string }> {
  return db.transaction().execute(async (trx) => {
    const project = await trx
      .updateTable("project")
      .set({
        nextChangeRequestSequence: sql`"nextChangeRequestSequence" + 1`,
        identifier: sql`COALESCE("identifier", derive_project_identifier("name", ${args.companyId}))`
      })
      .where("id", "=", args.projectId)
      .where("companyId", "=", args.companyId)
      .returning([
        sql<number>`"nextChangeRequestSequence" - 1`.as("sequence"),
        "identifier"
      ])
      .executeTakeFirst();
    if (!project) throw new Error("The project does not exist");

    const readableId = `${project.identifier}-CR-${project.sequence}`;
    const changeRequest = await trx
      .insertInto("projectChangeRequest")
      .values({
        companyId: args.companyId,
        projectId: args.projectId,
        readableId,
        title: args.title,
        reason: (args.reason == null ? null : toJson(args.reason)) as never,
        createdBy: args.userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const baseline = await insertProjectBaseline(trx, {
      companyId: args.companyId,
      userId: args.userId,
      projectId: args.projectId,
      name: `Before ${readableId}`,
      source: "Change Request",
      changeRequestId: changeRequest.id
    });
    await trx
      .updateTable("projectChangeRequest")
      .set({ baseBaselineId: baseline.id })
      .where("id", "=", changeRequest.id)
      .where("companyId", "=", args.companyId)
      .execute();

    return { id: changeRequest.id, readableId };
  });
}

/**
 * Moves a change request from one of `from` to `to`, with the extra columns
 * in `set`. Returns false when it is in another status or is not a change
 * request of the project.
 */
export async function setChangeRequestStatus(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    projectId: string;
    changeRequestId: string;
    from: readonly ProjectChangeRequestStatus[];
    to: ProjectChangeRequestStatus;
    set?: {
      submittedAt?: boolean;
      decided?: boolean;
      decisionNotes?: string | null;
      clearDecision?: boolean;
    };
  }
) {
  const now = sql<string>`NOW()`;
  const row = await db
    .updateTable("projectChangeRequest")
    .set({
      status: args.to,
      updatedBy: args.userId,
      updatedAt: now,
      ...(args.set?.submittedAt ? { submittedAt: now } : {}),
      ...(args.set?.decided
        ? {
            decidedBy: args.userId,
            decidedAt: now,
            decisionNotes: args.set.decisionNotes ?? null
          }
        : {}),
      ...(args.set?.clearDecision
        ? { decidedBy: null, decidedAt: null, decisionNotes: null }
        : {})
    })
    .where("id", "=", args.changeRequestId)
    .where("projectId", "=", args.projectId)
    .where("companyId", "=", args.companyId)
    .where("status", "in", [...args.from])
    .returning("id")
    .executeTakeFirst();
  return Boolean(row);
}

/**
 * Reopens a Rejected change request, or an Approved one whose apply hit a
 * conflict, as a Draft. The items are brought onto the live plan with
 * `rebaseChangeRequestItems`: the author then fixes what the live plan
 * changed. Returns the number of items it dropped.
 */
export async function reopenChangeRequest(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    projectId: string;
    changeRequestId: string;
  }
): Promise<{ dropped: number }> {
  return db.transaction().execute(async (trx) => {
    const changeRequest = await trx
      .selectFrom("projectChangeRequest")
      .select(["status", "projectId"])
      .where("id", "=", args.changeRequestId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!changeRequest || changeRequest.projectId !== args.projectId) {
      throw new ProjectChangeRequestError("The change request does not exist");
    }
    if (!["Rejected", "Approved"].includes(changeRequest.status)) {
      throw new ProjectChangeRequestError(
        `A ${changeRequest.status} change request cannot reopen`
      );
    }

    const [items, live] = await Promise.all([
      loadChangeRequestItems(trx, args),
      loadPlanSnapshot(trx, args)
    ]);
    const { keep, drop } = rebaseChangeRequestItems(items, live);
    const dropIds = drop
      .map((item) => (item as ChangeRequestItemRow).id)
      .filter(Boolean);
    if (dropIds.length > 0) {
      await trx
        .deleteFrom("projectChangeRequestItem")
        .where("id", "in", dropIds)
        .where("companyId", "=", args.companyId)
        .execute();
    }
    const rebased = keep.filter((item) => item.operation !== "Add");
    if (rebased.length > 0) {
      await sql`
        UPDATE "projectChangeRequestItem" AS i
        SET "payload" = v."payload",
            "baseRow" = v."baseRow",
            "updatedBy" = ${args.userId},
            "updatedAt" = NOW()
        FROM jsonb_to_recordset(${JSON.stringify(
          rebased.map((item) => ({
            id: (item as ChangeRequestItemRow).id,
            payload: item.payload,
            baseRow: item.baseRow
          }))
        )}::jsonb) AS v("id" TEXT, "payload" JSONB, "baseRow" JSONB)
        WHERE i."id" = v."id" AND i."companyId" = ${args.companyId}
      `.execute(trx);
    }
    await trx
      .updateTable("projectChangeRequest")
      .set({
        status: "Draft",
        decidedBy: null,
        decidedAt: null,
        decisionNotes: null,
        submittedAt: null,
        updatedBy: args.userId,
        updatedAt: sql`NOW()`
      })
      .where("id", "=", args.changeRequestId)
      .where("companyId", "=", args.companyId)
      .execute();
    return { dropped: drop.length };
  });
}

/** An apply refused because the live plan changed under the change request. */
export class ProjectChangeConflictError extends Error {
  status = 409;
  constructor(public conflicts: ChangeRequestConflict[]) {
    super(
      `The live plan changed under ${conflicts.length} row(s) of the change request`
    );
  }
}

/** The element columns an Add may set: the plan layer and the progress fields. */
const ADDED_ELEMENT_FIELDS = [
  ...PLAN_LAYER_FIELDS.projectElement.filter((field) => field !== "readableId"),
  "stateId",
  "ownerId",
  "priority",
  "milestoneId",
  "startDate",
  "targetDate"
];

/** Columns an Update never writes: identity and the project. */
const FIXED_PLAN_FIELDS = new Set(["id", "readableId", "projectId"]);

function presentFields(
  payload: Record<string, unknown> | null,
  fields: readonly string[]
) {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    if (payload && field in payload) values[field] = payload[field];
  }
  return values;
}

/**
 * Applies an Approved change request to the live plan, in one transaction,
 * and marks it Applied. It refuses with `ProjectChangeConflictError` when
 * the live plan changed under an item (`findConflicts`); the status stays
 * Approved. Order: element Adds (parents first, numbered from
 * `project.nextElementSequence`), element Updates, plan-line and link Adds
 * and Updates, link and plan-line Deletes, element Deletes. An element
 * Delete refuses when the element or one below it has a charge. A baseline
 * of the result is stored as `appliedBaselineId`. The plan lock does not
 * apply here: this is the one writer allowed to change a locked plan.
 */
export async function applyChangeRequest(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; userId: string; changeRequestId: string }
): Promise<{ applied: boolean }> {
  return db.transaction().execute(async (trx) => {
    const changeRequest = await trx
      .selectFrom("projectChangeRequest")
      .select(["projectId", "status", "readableId"])
      .where("id", "=", args.changeRequestId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!changeRequest || changeRequest.status !== "Approved") {
      return { applied: false };
    }
    const { projectId } = changeRequest;
    const scope = { companyId: args.companyId, projectId };

    // Lock the project first, so no live write lands between the conflict
    // check and the apply.
    await trx
      .selectFrom("project")
      .select("id")
      .where("id", "=", projectId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirstOrThrow();

    const [items, live] = await Promise.all([
      loadChangeRequestItems(trx, args),
      loadPlanSnapshot(trx, scope)
    ]);
    const conflicts = findConflicts(items, live);
    if (conflicts.length > 0) throw new ProjectChangeConflictError(conflicts);

    const ofTable = (
      table: ProjectPlanTable,
      operation: ProjectChangeOperation
    ) =>
      items.filter(
        (item) => item.targetTable === table && item.operation === operation
      );

    // 1. Element Adds, parents first.
    const pending = ofTable("projectElement", "Add");
    const ordered: ChangeRequestItemRow[] = [];
    const placed = new Set<string>();
    const addedIds = new Set(pending.map((item) => item.targetId));
    while (ordered.length < pending.length) {
      const ready = pending.filter(
        (item) =>
          !placed.has(item.targetId) &&
          (!item.payload?.parentId ||
            !addedIds.has(item.payload.parentId as string) ||
            placed.has(item.payload.parentId as string))
      );
      if (ready.length === 0) {
        throw new ProjectChangeRequestError(
          "The added elements form a loop of parents"
        );
      }
      for (const item of ready) {
        ordered.push(item);
        placed.add(item.targetId);
      }
    }
    if (ordered.length > 0) {
      const project = await trx
        .updateTable("project")
        .set({
          nextElementSequence: sql`"nextElementSequence" + ${ordered.length}`,
          identifier: sql`COALESCE("identifier", derive_project_identifier("name", ${args.companyId}))`
        })
        .where("id", "=", projectId)
        .where("companyId", "=", args.companyId)
        .returning([
          sql<number>`"nextElementSequence" - ${ordered.length}`.as("start"),
          "identifier"
        ])
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("projectElement")
        .values(
          ordered.map((item, index) => {
            const values = presentFields(item.payload, ADDED_ELEMENT_FIELDS);
            return {
              ...values,
              description:
                values.description == null ? null : toJson(values.description),
              id: item.targetId,
              projectId,
              companyId: args.companyId,
              readableId: `${project.identifier}-${project.start + index}`,
              sequence: project.start + index,
              createdBy: args.userId
            } as never;
          })
        )
        .execute();
    }

    // 2–3. Updates: one statement per table. `jsonb_populate_recordset`
    // casts each value to its column's type.
    const updateRows = async (table: ProjectPlanTable) => {
      const updates = ofTable(table, "Update");
      if (updates.length === 0) return;
      const columns = PLAN_LAYER_FIELDS[table].filter(
        (field) => !FIXED_PLAN_FIELDS.has(field)
      );
      const rows = updates.map((item) => ({
        ...presentFields(item.payload, columns),
        id: item.targetId
      }));
      await sql`
        UPDATE ${sql.table(table)}
        SET ${sql.join(
          columns.map(
            (column) => sql`${sql.ref(column)} = v.${sql.ref(column)}`
          )
        )},
            "updatedBy" = ${args.userId},
            "updatedAt" = NOW()
        FROM jsonb_populate_recordset(NULL::${sql.table(table)}, ${JSON.stringify(rows)}::jsonb) AS v
        WHERE ${sql.table(table)}."id" = v."id"
          AND ${sql.table(table)}."companyId" = ${args.companyId}
          AND ${sql.table(table)}."projectId" = ${projectId}
      `.execute(trx);
    };
    await updateRows("projectElement");

    const insertRows = async (
      table: Exclude<ProjectPlanTable, "projectElement">
    ) => {
      const adds = ofTable(table, "Add");
      if (adds.length === 0) return;
      await trx
        .insertInto(table as "projectElementCost")
        .values(
          adds.map(
            (item) =>
              ({
                ...presentFields(item.payload, PLAN_LAYER_FIELDS[table]),
                id: item.targetId,
                projectId,
                companyId: args.companyId,
                createdBy: args.userId
              }) as never
          )
        )
        .execute();
    };
    const lineTables = [
      "projectElementLink",
      "projectElementMaterial",
      "projectElementLabor",
      "projectElementCost"
    ] as const;
    for (const table of lineTables) {
      await insertRows(table);
      await updateRows(table);
    }

    // 4. Link and plan-line Deletes.
    for (const table of lineTables) {
      const ids = ofTable(table, "Delete").map((item) => item.targetId);
      if (ids.length === 0) continue;
      await trx
        .deleteFrom(table as "projectElementCost")
        .where("id", "in", ids)
        .where("projectId", "=", projectId)
        .where("companyId", "=", args.companyId)
        .execute();
    }

    // 5. Element Deletes. The parent FK cascades to the children, so one
    // statement removes every subtree; first refuse any subtree with charges.
    const deleted = ofTable("projectElement", "Delete").map(
      (item) => item.targetId
    );
    if (deleted.length > 0) {
      const charged = await sql<{ readableId: string; source: string }>`
        WITH RECURSIVE subtree AS (
          SELECT "id", "readableId" FROM "projectElement"
          WHERE "id" IN (${sql.join(deleted)})
            AND "projectId" = ${projectId}
            AND "companyId" = ${args.companyId}
          UNION
          SELECT e."id", e."readableId" FROM "projectElement" e
          JOIN subtree s ON e."parentId" = s."id"
          WHERE e."projectId" = ${projectId}
            AND e."companyId" = ${args.companyId}
        )
        SELECT s."readableId", 'costs' AS "source" FROM subtree s
          WHERE EXISTS (SELECT 1 FROM "projectLedger" l
            WHERE l."projectElementId" = s."id" AND l."companyId" = ${args.companyId})
        UNION ALL
        SELECT s."readableId", 'time' FROM subtree s
          WHERE EXISTS (SELECT 1 FROM "timesheetEntry" t
            WHERE t."projectElementId" = s."id" AND t."companyId" = ${args.companyId})
        UNION ALL
        SELECT s."readableId", 'a job' FROM subtree s
          WHERE EXISTS (SELECT 1 FROM "job" j
            WHERE j."projectElementId" = s."id" AND j."companyId" = ${args.companyId})
        UNION ALL
        SELECT s."readableId", 'a purchase order line' FROM subtree s
          WHERE EXISTS (SELECT 1 FROM "purchaseOrderLine" p
            WHERE p."projectElementId" = s."id" AND p."companyId" = ${args.companyId})
        LIMIT 1
      `.execute(trx);
      const first = charged.rows[0];
      if (first) {
        throw new ProjectChangeRequestError(
          `${first.readableId} has ${first.source} charged to it. The change request cannot delete it.`
        );
      }
      await trx
        .deleteFrom("projectElement")
        .where("id", "in", deleted)
        .where("projectId", "=", projectId)
        .where("companyId", "=", args.companyId)
        .execute();
    }

    const baseline = await insertProjectBaseline(trx, {
      companyId: args.companyId,
      userId: args.userId,
      projectId,
      name: `After ${changeRequest.readableId}`,
      source: "Change Request",
      changeRequestId: args.changeRequestId
    });
    const applied = await trx
      .updateTable("projectChangeRequest")
      .set({
        status: "Applied",
        appliedBaselineId: baseline.id,
        appliedAt: sql`NOW()`,
        updatedBy: args.userId,
        updatedAt: sql`NOW()`
      })
      .where("id", "=", args.changeRequestId)
      .where("companyId", "=", args.companyId)
      .where("status", "=", "Approved")
      .returning("id")
      .executeTakeFirst();
    if (!applied) throw new Error("The change request is no longer Approved");
    return { applied: true };
  });
}

/** The element a change request item belongs to: its card on the review page. */
export function changeRequestItemElementId(item: ChangeRequestItem) {
  if (item.targetTable === "projectElement") return item.targetId;
  const row = item.payload ?? item.baseRow ?? {};
  const id =
    item.targetTable === "projectElementLink"
      ? row.fromElementId
      : row.projectElementId;
  return typeof id === "string" ? id : null;
}

/**
 * Everything the change request review page shows: the change request, the
 * diff it makes (the live plan against the overlay; for an Applied one, its
 * Before and After baselines), its comments, the elements the user marked
 * viewed since their last change, and the conflicts of an Approved one.
 */
export async function getChangeRequestReview(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    projectId: string;
    changeRequestId: string;
    userId: string;
  }
) {
  const db = getDatabaseClient();
  const [changeRequest, overlay, comments, views] = await Promise.all([
    getProjectChangeRequest(client, args.changeRequestId, args.companyId),
    loadChangeRequestOverlay(db, args),
    client
      .from("projectChangeRequestComment")
      .select("*")
      .eq("changeRequestId", args.changeRequestId)
      .eq("companyId", args.companyId)
      .order("createdAt", { ascending: true }),
    client
      .from("projectChangeRequestView")
      .select("targetTable, targetId, viewedAt")
      .eq("changeRequestId", args.changeRequestId)
      .eq("companyId", args.companyId)
      .eq("userId", args.userId)
  ]);
  if (changeRequest.error) return { data: null, error: changeRequest.error };
  if (!overlay) return { data: null, error: null };
  if (comments.error) return { data: null, error: comments.error };
  if (views.error) return { data: null, error: views.error };

  let diff = diffPlanSnapshots(overlay.live, overlay.overlay);
  const { baseBaselineId, appliedBaselineId, status } = changeRequest.data;
  if (status === "Applied" && baseBaselineId && appliedBaselineId) {
    const [before, after] = await Promise.all([
      getProjectBaseline(client, baseBaselineId, args.companyId),
      getProjectBaseline(client, appliedBaselineId, args.companyId)
    ]);
    if (before.error || after.error) {
      return { data: null, error: before.error ?? after.error };
    }
    diff = diffPlanSnapshots(
      parsePlanSnapshot(before.data.snapshot),
      parsePlanSnapshot(after.data.snapshot)
    );
  }

  // A Viewed mark counts until a change of its element is newer than it.
  const lastChange = new Map<string, number>();
  for (const item of overlay.items) {
    const elementId = changeRequestItemElementId(item);
    if (!elementId) continue;
    const at = Date.parse(item.updatedAt ?? item.createdAt);
    lastChange.set(elementId, Math.max(lastChange.get(elementId) ?? 0, at));
  }
  const viewedElementIds = (views.data ?? [])
    .filter(
      (view) =>
        view.targetTable === "projectElement" &&
        Date.parse(view.viewedAt) >= (lastChange.get(view.targetId) ?? 0)
    )
    .map((view) => view.targetId);

  const laborCategoryIds = [
    ...new Set(
      diff.labor
        .flatMap((entry) => [
          entry.before?.laborCategoryId,
          entry.after?.laborCategoryId
        ])
        .filter((id): id is string => typeof id === "string")
    )
  ];
  const laborCategories =
    laborCategoryIds.length > 0
      ? await getLaborCategoryNames(client, laborCategoryIds, args.companyId)
      : null;
  if (laborCategories?.error) {
    return { data: null, error: laborCategories.error };
  }

  // A conflict names its element by the readable id it has now.
  const elementLabel = new Map(
    [...overlay.live.elements, ...overlay.overlay.elements].map((row) => [
      row.id,
      String(row.readableId || row.name || "")
    ])
  );
  const conflicts =
    status === "Approved"
      ? findConflicts(overlay.items, overlay.live).map((conflict) => {
          const item = overlay.items.find(
            (i) =>
              i.targetTable === conflict.targetTable &&
              i.targetId === conflict.targetId
          );
          const elementId = item ? changeRequestItemElementId(item) : null;
          return {
            ...conflict,
            elementId,
            elementLabel: elementId ? (elementLabel.get(elementId) ?? "") : ""
          };
        })
      : [];

  return {
    data: {
      changeRequest: changeRequest.data,
      diff,
      laborCategoryNames: Object.fromEntries(
        (laborCategories?.data ?? []).map((c) => [c.id, c.name])
      ) as Record<string, string>,
      comments: comments.data ?? [],
      viewedElementIds,
      conflicts,
      liveElementIds: overlay.live.elements.map((row) => row.id)
    },
    error: null
  };
}

export type ChangeRequestReview = NonNullable<
  Awaited<ReturnType<typeof getChangeRequestReview>>["data"]
>;

// --- Plan lock (Phase 1c) -------------------------------------------------------

/**
 * Null when a plan-layer write may run: the plan is not locked, or the write
 * goes into a Draft change request of the project. Otherwise the refusal
 * message (`projectPlanLockedMessage`). `applyChangeRequest` never calls it:
 * the apply is the one writer allowed to change a locked plan.
 */
export async function requireProjectPlanEditable(
  client: SupabaseClient<Database>,
  args: {
    projectId: string;
    companyId: string;
    changeRequestId: string | null;
  }
): Promise<string | null> {
  const project = await client
    .from("project")
    .select(
      "lockPlanAfterMilestoneId, lockMilestone:projectMilestone!project_lockMilestone_fkey(name, completedAt)"
    )
    .eq("id", args.projectId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (project.error) throw project.error;
  const lockMilestone = project.data?.lockMilestone ?? null;
  if (!isProjectPlanLocked({ lockMilestone })) return null;

  if (args.changeRequestId) {
    const changeRequest = await client
      .from("projectChangeRequest")
      .select("status")
      .eq("id", args.changeRequestId)
      .eq("projectId", args.projectId)
      .eq("companyId", args.companyId)
      .maybeSingle();
    if (changeRequest.error) throw changeRequest.error;
    if (changeRequest.data?.status === "Draft") return null;
  }
  return projectPlanLockedMessage(lockMilestone?.name ?? "");
}

/**
 * The route form of `requireProjectPlanEditable`: null, or a refusal with
 * `error.message` and, unless `withFlash` is false, a flash.
 */
export async function requireEditablePlanRoute(
  request: Request,
  args: {
    client: SupabaseClient<Database>;
    projectId: string;
    companyId: string;
    changeRequestId: string | null;
    /** False for the routes whose fetchers toast `error.message` themselves. */
    withFlash?: boolean;
  }
) {
  const message = await requireProjectPlanEditable(args.client, args);
  if (!message) return null;
  const body = { success: false, error: { message } };
  return args.withFlash === false
    ? data(body)
    : data(body, await flash(request, error(null, message)));
}

/**
 * What a job created on a charge number builds into: the project's cost
 * treatment and, for Capitalize, the asset under construction (the element's
 * own when it is a final asset, else its nearest final-asset ancestor's, else
 * the project's), as `getChargeNumbers` resolves it. One query.
 */
export async function getJobChargeTarget(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    projectId: string;
    projectElementId: string | null;
  }
): Promise<{
  costTreatment: Database["public"]["Enums"]["projectCostTreatment"];
  fixedAssetId: string | null;
} | null> {
  const result = await sql<{
    costTreatment: Database["public"]["Enums"]["projectCostTreatment"];
    fixedAssetId: string | null;
  }>`
    WITH RECURSIVE chain AS (
      SELECT e."id", e."parentId", e."isFinalAsset", e."fixedAssetId", 0 AS depth
      FROM "projectElement" e
      WHERE e."id" = ${args.projectElementId}
        AND e."projectId" = ${args.projectId}
        AND e."companyId" = ${args.companyId}
      UNION ALL
      SELECT p."id", p."parentId", p."isFinalAsset", p."fixedAssetId", chain.depth + 1
      FROM "projectElement" p
      JOIN chain ON p."id" = chain."parentId"
      WHERE p."companyId" = ${args.companyId} AND chain.depth < 100
    )
    SELECT
      pr."costTreatment",
      CASE
        WHEN pr."costTreatment" <> 'Capitalize' THEN NULL
        -- The nearest final asset decides, even before its asset exists.
        WHEN EXISTS (SELECT 1 FROM chain c WHERE c."isFinalAsset") THEN
          (SELECT c."fixedAssetId" FROM chain c WHERE c."isFinalAsset" ORDER BY c.depth LIMIT 1)
        ELSE pr."fixedAssetId"
      END AS "fixedAssetId"
    FROM "project" pr
    WHERE pr."id" = ${args.projectId} AND pr."companyId" = ${args.companyId}
  `.execute(db);
  return result.rows[0] ?? null;
}

/**
 * Creates the CIP assets of a capital project, in one transaction: the
 * project's own asset, and one asset per final-asset element that has none.
 * Each asset starts Under Construction at cost 0 in the project's CIP class,
 * with the class's depreciation settings. Does nothing for a project that is
 * not Capitalize or has no CIP class. Safe to call again: an element or a
 * project that already holds an asset keeps it.
 */
export async function ensureCapitalAssets(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; userId: string; projectId: string }
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const project = await trx
      .selectFrom("project")
      .select([
        "id",
        "identifier",
        "name",
        "costTreatment",
        "fixedAssetClassId",
        "fixedAssetId",
        "locationId"
      ])
      .where("id", "=", args.projectId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (
      !project ||
      project.costTreatment !== "Capitalize" ||
      !project.fixedAssetClassId
    ) {
      return;
    }

    const assetClass = await trx
      .selectFrom("fixedAssetClass")
      .select([
        "id",
        "isConstructionInProgress",
        "depreciationMethod",
        "usefulLifeMonths",
        "residualValuePercent",
        "taxDepreciationMethod",
        "taxUsefulLifeMonths",
        "taxResidualValuePercent",
        "macrsPropertyClass",
        "macrsConvention",
        "bonusDepreciationPercent"
      ])
      .where("id", "=", project.fixedAssetClassId)
      .where("companyId", "=", args.companyId)
      .executeTakeFirst();
    if (!assetClass?.isConstructionInProgress) {
      throw new Error(
        "The project's fixed asset class is not a Construction in Progress class"
      );
    }

    const elements = await trx
      .selectFrom("projectElement")
      .select(["id", "readableId", "name"])
      .where("projectId", "=", project.id)
      .where("companyId", "=", args.companyId)
      .where("isFinalAsset", "=", true)
      .where("fixedAssetId", "is", null)
      .orderBy("readableId")
      .execute();

    const wanted: { elementId: string | null; name: string }[] = [
      ...(project.fixedAssetId
        ? []
        : [
            {
              elementId: null,
              name: [project.identifier, project.name].filter(Boolean).join(" ")
            }
          ]),
      ...elements.map((element) => ({
        elementId: element.id,
        name: `${element.readableId} ${element.name}`
      }))
    ];
    if (wanted.length === 0) return;

    // One statement allocates every id and asset number.
    const allocated = await sql<{ id: string; fixedAssetId: string }>`
      SELECT xid() AS "id",
        get_next_sequence('fixedAsset', ${args.companyId}) AS "fixedAssetId"
      FROM generate_series(1, ${wanted.length})
    `.execute(trx);
    const assets = wanted.map((asset, index) => ({
      ...asset,
      id: allocated.rows[index]!.id,
      fixedAssetId: allocated.rows[index]!.fixedAssetId
    }));

    await trx
      .insertInto("fixedAsset")
      .values(
        assets.map((asset) => ({
          id: asset.id,
          fixedAssetId: asset.fixedAssetId,
          fixedAssetClassId: assetClass.id,
          name: asset.name,
          status: "Under Construction" as const,
          acquisitionCost: 0,
          depreciationMethod: assetClass.depreciationMethod,
          usefulLifeMonths: assetClass.usefulLifeMonths,
          residualValuePercent: assetClass.residualValuePercent,
          taxDepreciationMethod: assetClass.taxDepreciationMethod,
          taxUsefulLifeMonths: assetClass.taxUsefulLifeMonths,
          taxResidualValuePercent: assetClass.taxResidualValuePercent,
          macrsPropertyClass: assetClass.macrsPropertyClass,
          macrsConvention: assetClass.macrsConvention,
          bonusDepreciationPercent: assetClass.bonusDepreciationPercent,
          locationId: project.locationId,
          companyId: args.companyId,
          createdBy: args.userId,
          updatedBy: args.userId
        }))
      )
      .execute();

    const projectAsset = assets.find((asset) => asset.elementId === null);
    if (projectAsset) {
      await trx
        .updateTable("project")
        .set({
          fixedAssetId: projectAsset.id,
          updatedBy: args.userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", project.id)
        .where("companyId", "=", args.companyId)
        .execute();
    }

    const elementAssets = assets.filter(
      (asset): asset is typeof asset & { elementId: string } =>
        asset.elementId !== null
    );
    if (elementAssets.length > 0) {
      await sql`
        UPDATE "projectElement" e
        SET "fixedAssetId" = v."fixedAssetId",
          "updatedBy" = ${args.userId},
          "updatedAt" = NOW()
        FROM (VALUES ${sql.join(
          elementAssets.map((asset) => sql`(${asset.elementId}, ${asset.id})`)
        )}) AS v("elementId", "fixedAssetId")
        WHERE e."id" = v."elementId"
          AND e."companyId" = ${args.companyId}
          AND e."projectId" = ${project.id}
      `.execute(trx);
    }
  });
}

export type ProjectCapitalAsset = {
  id: string;
  fixedAssetId: string;
  name: string;
  status: Database["public"]["Enums"]["fixedAssetStatus"];
  className: string;
  /** Σ fixedAssetCipCost: what a capitalization moves. */
  cipTotal: number;
  /** The final-asset element that holds the asset; null for the project's. */
  elementId: string | null;
  elementReadableId: string | null;
};

/**
 * The capital assets of a project: its own asset and the asset of each
 * final-asset element, with each asset's CIP total. One query.
 */
export async function getProjectCapitalAssets(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; projectId: string }
): Promise<ProjectCapitalAsset[]> {
  const rows = await sql<{
    id: string;
    fixedAssetId: string;
    name: string;
    status: Database["public"]["Enums"]["fixedAssetStatus"];
    className: string;
    cipTotal: number | null;
    elementId: string | null;
    elementReadableId: string | null;
  }>`
    WITH holders AS (
      SELECT p."fixedAssetId", NULL::text AS "elementId", NULL::text AS "elementReadableId"
      FROM "project" p
      WHERE p."id" = ${args.projectId} AND p."companyId" = ${args.companyId}
        AND p."fixedAssetId" IS NOT NULL
      UNION ALL
      SELECT e."fixedAssetId", e."id", e."readableId"
      FROM "projectElement" e
      WHERE e."projectId" = ${args.projectId} AND e."companyId" = ${args.companyId}
        AND e."isFinalAsset" AND e."fixedAssetId" IS NOT NULL
    )
    SELECT a."id", a."fixedAssetId", a."name", a."status", c."name" AS "className",
      (SELECT SUM(cc."amount") FROM "fixedAssetCipCost" cc
        WHERE cc."fixedAssetId" = a."id" AND cc."companyId" = a."companyId"
          AND NOT cc."postCapitalization") AS "cipTotal",
      h."elementId", h."elementReadableId"
    FROM holders h
    JOIN "fixedAsset" a ON a."id" = h."fixedAssetId" AND a."companyId" = ${args.companyId}
    JOIN "fixedAssetClass" c ON c."id" = a."fixedAssetClassId"
    ORDER BY h."elementReadableId" NULLS FIRST
  `.execute(db);
  return rows.rows.map((row) => ({
    ...row,
    cipTotal: Number(row.cipTotal ?? 0)
  }));
}

/**
 * Moves elements and all their descendants to the project's default
 * Completed state (else its first Completed state), in one statement. Used
 * when their asset goes into service.
 */
export async function completeElementSubtrees(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    projectId: string;
    elementIds: string[];
    userId: string;
  }
): Promise<void> {
  if (args.elementIds.length === 0) return;
  await sql`
    WITH RECURSIVE subtree AS (
      SELECT e."id" FROM "projectElement" e
      WHERE e."id" IN (${sql.join(args.elementIds)})
        AND e."projectId" = ${args.projectId}
        AND e."companyId" = ${args.companyId}
      UNION
      SELECT c."id" FROM "projectElement" c
      JOIN subtree s ON c."parentId" = s."id"
      WHERE c."companyId" = ${args.companyId}
    ), completed AS (
      SELECT st."id" FROM "projectState" st
      WHERE st."projectId" = ${args.projectId}
        AND st."companyId" = ${args.companyId}
        AND st."group" = 'Completed'
      ORDER BY st."isDefault" DESC, st."sortOrder", st."id"
      LIMIT 1
    )
    UPDATE "projectElement" e
    SET "stateId" = completed."id",
      "completedAt" = COALESCE(e."completedAt", NOW()),
      "updatedBy" = ${args.userId},
      "updatedAt" = NOW()
    FROM completed
    WHERE e."id" IN (SELECT "id" FROM subtree)
      AND e."companyId" = ${args.companyId}
  `.execute(db);
}

/**
 * Inserts an element, in one transaction. The project's sequence gives the
 * element its readable id (`ST-12`). An empty state takes the project's
 * default Unstarted state. An absent `isChargeable` takes the type's
 * default. The element goes after its last sibling.
 */
export async function insertProjectElement(
  db: Kysely<KyselyDatabase>,
  args: Omit<z.infer<typeof projectElementValidator>, "id"> & {
    projectId: string;
    companyId: string;
    userId: string;
  }
): Promise<{ id: string; readableId: string }> {
  return db.transaction().execute(async (trx) => {
    const project = await trx
      .updateTable("project")
      .set({ nextElementSequence: sql`"nextElementSequence" + 1` })
      .where("id", "=", args.projectId)
      .where("companyId", "=", args.companyId)
      .returning([
        sql<number>`"nextElementSequence" - 1`.as("seq"),
        "identifier",
        "name"
      ])
      .executeTakeFirst();
    if (!project) throw new Error("The project does not exist");

    let identifier = project.identifier;
    if (!identifier) {
      const derived = await trx
        .updateTable("project")
        .set({
          identifier: sql<string>`derive_project_identifier(${project.name}, ${args.companyId})`
        })
        .where("id", "=", args.projectId)
        .where("companyId", "=", args.companyId)
        .returning("identifier")
        .executeTakeFirstOrThrow();
      identifier = derived.identifier;
    }

    if (args.parentId) {
      const parent = await trx
        .selectFrom("projectElement")
        .select("type")
        .where("id", "=", args.parentId)
        .where("projectId", "=", args.projectId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (!parent) throw new Error("The parent element does not exist");
      // A Parameter's children are Parameters: they roll up into it.
      if (parent.type === "Parameter" && args.type !== "Parameter") {
        throw new Error("A Parameter can only have Parameters as children");
      }
    }

    let stateId = args.stateId;
    if (!stateId) {
      // The default Unstarted state; else the first Unstarted state.
      const state = await trx
        .selectFrom("projectState")
        .select("id")
        .where("projectId", "=", args.projectId)
        .where("companyId", "=", args.companyId)
        .where("group", "=", "Unstarted")
        .orderBy("isDefault", "desc")
        .orderBy("sortOrder", "asc")
        .limit(1)
        .executeTakeFirst();
      if (!state) throw new Error("The project has no Unstarted state");
      stateId = state.id;
    }

    let siblings = trx
      .selectFrom("projectElement")
      .select(sql<number>`COALESCE(MAX("sortOrder"), 0)`.as("maxSortOrder"))
      .where("projectId", "=", args.projectId)
      .where("companyId", "=", args.companyId);
    siblings = args.parentId
      ? siblings.where("parentId", "=", args.parentId)
      : siblings.where("parentId", "is", null);
    const { maxSortOrder } = await siblings.executeTakeFirstOrThrow();

    const isChargeable =
      args.type === "Parameter"
        ? false
        : (args.isChargeable ?? chargeableByDefault[args.type]);
    const readableId = `${identifier}-${project.seq}`;

    const element = await trx
      .insertInto("projectElement")
      .values({
        projectId: args.projectId,
        companyId: args.companyId,
        readableId,
        sequence: project.seq,
        type: args.type,
        parentId: args.parentId ?? null,
        name: args.name,
        stateId,
        ownerId: args.ownerId ?? null,
        priority: args.priority ?? "None",
        milestoneId: args.milestoneId ?? null,
        startDate: args.startDate ?? null,
        targetDate: args.targetDate ?? null,
        estimatedHours: args.estimatedHours ?? null,
        isChargeable,
        budget: args.budget ?? null,
        itemId: args.itemId ?? null,
        sortOrder: Number(maxSortOrder) + 1,
        createdBy: args.userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return { id: element.id, readableId };
  });
}

// --- Build from part ------------------------------------------------------------

export type BuildFromPartArgs = {
  companyId: string;
  projectId: string;
  parentId: string | null;
  source:
    | { trackedEntityId: string }
    | { itemId: string }
    | { templateProjectId: string };
  depth: number;
  includeBought: boolean;
};

/**
 * The upstream build of a serial: what was consumed to make it, then what was
 * consumed to make each of those, one level at a time. Each level is two RPC
 * calls for all its entities, one read of the activity types and one read of
 * the entities' items, never one per entity.
 * `get_direct_descendants_of_tracked_entities_strict` returns the inputs of
 * the activities that output a seed (the upstream side, despite its name).
 * `netBuildComponents` decides what is still in the build: a Consume or a
 * Service input not given back by a later Unconsume (the ancestors RPC
 * returns those as the Unconsume's outputs), not scrapped, and not removed
 * from the customer asset by a later service order. One more query per level
 * reads those removals.
 */
async function loadSerialBuildNodes(
  db: Kysely<KyselyDatabase> | KyselyTx,
  args: { companyId: string; trackedEntityId: string; depth: number }
): Promise<BuildSourceNode[]> {
  const seed = await db
    .selectFrom("trackedEntity")
    .select("id")
    .where("id", "=", args.trackedEntityId)
    .where("companyId", "=", args.companyId)
    .executeTakeFirst();
  if (!seed) throw new Error("The serial was not found");

  const nodes: BuildSourceNode[] = [];
  // The node keys of each entity on the current level (the seed has none).
  let level = new Map<string, (string | null)[]>([[seed.id, [null]]]);
  const visited = new Set<string>([seed.id]);

  for (let depth = 1; depth <= args.depth && level.size > 0; depth++) {
    const ids = [...level.keys()];
    const [consumed, given] = await Promise.all([
      sql<BuildTraceRow>`
        SELECT "sourceEntityId", "trackedActivityId", "id", "status"
        FROM get_direct_descendants_of_tracked_entities_strict(${ids}::text[], ${args.companyId})
      `.execute(db),
      sql<BuildTraceRow>`
        SELECT "sourceEntityId", "trackedActivityId", "id", "status"
        FROM get_direct_ancestors_of_tracked_entities_strict(${ids}::text[], ${args.companyId})
      `.execute(db)
    ]);
    const activityIds = [
      ...new Set(
        [...consumed.rows, ...given.rows].map((row) => row.trackedActivityId)
      )
    ];
    if (activityIds.length === 0) break;
    // The removal read: components a later service order removed from the
    // assembly's customer asset (every component row of the pair removed).
    const [activities, removedRows] = await Promise.all([
      db
        .selectFrom("trackedActivity")
        .select(["id", "type"])
        .where("id", "in", activityIds)
        .where("companyId", "=", args.companyId)
        .execute(),
      sql<{ assembly: string; component: string }>`
        SELECT ca."trackedEntityId" AS "assembly", c."trackedEntityId" AS "component"
        FROM "customerAssetComponent" c
        JOIN "customerAsset" ca
          ON ca."id" = c."customerAssetId" AND ca."companyId" = c."companyId"
        WHERE c."companyId" = ${args.companyId}
          AND ca."trackedEntityId" = ANY(${ids}::text[])
          AND c."trackedEntityId" IS NOT NULL
        GROUP BY ca."trackedEntityId", c."trackedEntityId"
        HAVING bool_and(c."removedDate" IS NOT NULL)
      `.execute(db)
    ]);
    const typeOf = new Map(activities.map((a) => [a.id, a.type]));
    const pairs = netBuildComponents({
      consumed: consumed.rows,
      given: given.rows,
      typeOf,
      removed: new Set(
        removedRows.rows.map((row) => `${row.assembly} ${row.component}`)
      )
    });
    if (pairs.length === 0) break;

    const componentIds = [...new Set(pairs.map((pair) => pair.component))];
    const entities = await db
      .selectFrom("trackedEntity as te")
      .leftJoin("item as i", "i.id", "te.itemId")
      .select([
        "te.id",
        "te.readableId",
        "te.itemId",
        "i.name",
        "i.readableIdWithRevision",
        "i.itemTrackingType",
        "i.replenishmentSystem"
      ])
      .where("te.id", "in", componentIds)
      .where("te.companyId", "=", args.companyId)
      .execute();
    const entityById = new Map(entities.map((e) => [e.id, e]));

    const next = new Map<string, (string | null)[]>();
    for (const { assembly, component } of pairs) {
      const entity = entityById.get(component);
      if (!entity) continue;
      const isSerial = entity.itemTrackingType === "Serial";
      const itemName =
        entity.name ?? entity.readableIdWithRevision ?? entity.readableId ?? "";
      for (const parentKey of level.get(assembly) ?? []) {
        if (nodes.length >= BUILD_FROM_PART_MAX_NODES) break;
        const key = `${parentKey ?? ""}/${component}`;
        nodes.push({
          key,
          parentKey,
          itemId: entity.itemId,
          trackedEntityId: isSerial ? entity.id : null,
          name:
            isSerial && entity.readableId
              ? `${itemName} ${entity.readableId}`
              : itemName,
          replenishment: entity.replenishmentSystem === "Buy" ? "Buy" : "Make"
        });
        if (!visited.has(component)) {
          next.set(component, [...(next.get(component) ?? []), key]);
        }
      }
    }
    for (const id of next.keys()) visited.add(id);
    if (nodes.length >= BUILD_FROM_PART_MAX_NODES) break;
    level = next;
  }
  return nodes;
}

type MethodTreeNode = NonNullable<
  Awaited<ReturnType<typeof getMethodTree>>["data"]
>[number];

/**
 * The make method tree of an item: Make to Order lines are Make nodes, every
 * other line a Buy node. The lines below a Pull from Inventory line
 * (`isPickDescendant`) are left out. `get_method_tree` inner-joins
 * `itemCost`, so a line whose item has no cost row is missing:
 * `skippedLines` counts them on the make methods the walk reached.
 */
async function loadItemBuildNodes(
  client: SupabaseClient<Database>,
  args: { companyId: string; itemId: string; depth: number }
): Promise<{ nodes: BuildSourceNode[]; skippedLines: number }> {
  const makeMethod = await client
    .from("activeMakeMethods")
    .select("id")
    .eq("itemId", args.itemId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (makeMethod.error) throw makeMethod.error;
  if (!makeMethod.data?.id) throw new Error("The item has no make method");

  const tree = await getMethodTree(client, makeMethod.data.id);
  if (tree.error) throw tree.error;
  const root = tree.data?.[0] as MethodTreeNode | undefined;

  const nodes: BuildSourceNode[] = [];
  const shownByMethod = new Map<string, Set<string>>();
  const walkedMethods = new Set<string>([makeMethod.data.id]);
  const walk = (
    children: MethodTreeNode[],
    parentKey: string | null,
    level: number
  ) => {
    for (const child of children) {
      const row = child.data;
      if (!row || row.isPickDescendant) continue;
      if (nodes.length >= BUILD_FROM_PART_MAX_NODES) return;
      const shown = shownByMethod.get(row.makeMethodId) ?? new Set<string>();
      shown.add(row.methodMaterialId);
      shownByMethod.set(row.makeMethodId, shown);
      const isMade = row.methodType === "Make to Order";
      nodes.push({
        key: child.id,
        parentKey,
        itemId: row.itemId,
        trackedEntityId: null,
        name: row.description || row.itemReadableId,
        replenishment: isMade ? "Make" : "Buy"
      });
      if (isMade && level < args.depth) {
        if (row.materialMakeMethodId) {
          walkedMethods.add(row.materialMakeMethodId);
        }
        walk(child.children ?? [], child.id, level + 1);
      }
    }
  };
  walk(root?.children ?? [], null, 1);

  // The lines get_method_tree dropped for a missing itemCost row.
  const lines = await client
    .from("methodMaterial")
    .select("id, makeMethodId")
    .in("makeMethodId", [...walkedMethods])
    .eq("companyId", args.companyId);
  if (lines.error) throw lines.error;
  const skippedLines = (lines.data ?? []).filter(
    (line) => !shownByMethod.get(line.makeMethodId)?.has(line.id)
  ).length;

  return { nodes, skippedLines };
}

/** One table of a template project, every column. */
function ofTemplate(
  db: Kysely<KyselyDatabase> | KyselyTx,
  table: "projectElement" | "projectElementLink" | "projectState",
  args: { companyId: string; templateProjectId: string }
) {
  return db
    .selectFrom(table as "projectElement")
    .selectAll()
    .where("projectId", "=", args.templateProjectId)
    .where("companyId", "=", args.companyId)
    .execute();
}

/** A preview row of Build from part: one element it would create. */
export type BuildFromPartPreviewRow = {
  id: string;
  parentId: string | null;
  type: ProjectElementType;
  name: string;
  readableId: string;
  itemId: string | null;
  trackedEntityId: string | null;
};

type BuildRow = Record<string, unknown> & {
  id: string;
  parentId: string | null;
  type: ProjectElementType;
  name: string;
  readableId: string;
};

type BuildTarget = {
  identifier: string;
  startSequence: number;
  startSortOrder: number;
  states: { id: string; group: ProjectStateGroup; isDefault: boolean }[];
};

/**
 * Plans the elements Build from part makes under `parentId`. A Template
 * source copies the template's elements down to `depth` levels with
 * `planProjectCopy`; their states map to this project's default state of the
 * same group. Returns the element rows (parents first), the template's links
 * between them, and the count of BOM lines the source could not read.
 */
async function planBuildFromPart(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase> | KyselyTx,
  args: BuildFromPartArgs & BuildTarget
): Promise<{
  rows: BuildRow[];
  links: Record<string, unknown>[];
  skippedLines: number;
}> {
  const stateOfGroup = (group: ProjectStateGroup) =>
    args.states.find((s) => s.group === group && s.isDefault)?.id ??
    args.states.find((s) => s.group === group)?.id;
  const defaultStateId = stateOfGroup("Unstarted");
  if (!defaultStateId) throw new Error("The project has no Unstarted state");

  if ("templateProjectId" in args.source) {
    const source = {
      companyId: args.companyId,
      templateProjectId: args.source.templateProjectId
    };
    const template = await db
      .selectFrom("project")
      .select(["id", "isTemplate"])
      .where("id", "=", source.templateProjectId)
      .where("companyId", "=", args.companyId)
      .executeTakeFirst();
    if (!template?.isTemplate) throw new Error("The template was not found");
    const [elements, links, templateStates] = await Promise.all([
      ofTemplate(db, "projectElement", source),
      ofTemplate(db, "projectElementLink", source),
      ofTemplate(db, "projectState", source)
    ]);

    // Keep the template's elements down to `depth` levels.
    const byId = new Map(elements.map((e) => [e.id, e]));
    const levelOf = (id: string) => {
      let level = 1;
      let current = byId.get(id);
      const seen = new Set<string>();
      while (current?.parentId && !seen.has(current.id)) {
        seen.add(current.id);
        current = byId.get(current.parentId);
        level++;
      }
      return level;
    };
    const keptElements = elements.filter((e) => levelOf(e.id) <= args.depth);
    const groupOfState = new Map(
      (
        templateStates as unknown as { id: string; group: ProjectStateGroup }[]
      ).map((state) => [state.id, state.group])
    );

    const plan = planProjectCopy(
      {
        states: [],
        labels: [],
        milestones: [],
        elements: keptElements as unknown as ProjectCopyElement[],
        elementLabels: [],
        links: links as unknown as ProjectCopySource["links"],
        materials: [],
        labor: [],
        costs: []
      },
      args.projectId,
      args.identifier,
      makeCopyId,
      args.startSequence
    );
    let rootSort = args.startSortOrder;
    const rows = plan.elements.map((element) => {
      const group = groupOfState.get(element.stateId);
      const isRoot = element.parentId === null;
      return {
        ...element,
        parentId: element.parentId ?? args.parentId,
        stateId: (group && stateOfGroup(group)) ?? defaultStateId,
        sortOrder: isRoot
          ? ++rootSort
          : (element as Record<string, unknown>).sortOrder
      } as unknown as BuildRow;
    });
    return { rows, links: plan.links, skippedLines: 0 };
  }

  let nodes: BuildSourceNode[];
  let skippedLines = 0;
  if ("trackedEntityId" in args.source) {
    nodes = await loadSerialBuildNodes(db, {
      companyId: args.companyId,
      trackedEntityId: args.source.trackedEntityId,
      depth: args.depth
    });
  } else {
    const loaded = await loadItemBuildNodes(client, {
      companyId: args.companyId,
      itemId: args.source.itemId,
      depth: args.depth
    });
    nodes = loaded.nodes;
    skippedLines = loaded.skippedLines;
  }
  const rows: PlannedBuildElement[] = planElementsFromSource({
    nodes,
    parentId: args.parentId,
    depth: args.depth,
    includeBought: args.includeBought,
    makeId: () => makeCopyId(projectCopyIdPrefixes.element),
    startSequence: args.startSequence,
    identifier: args.identifier,
    defaultStateId,
    startSortOrder: args.startSortOrder
  });
  return { rows, links: [], skippedLines };
}

/** Reads the project, its states and the parent for a build. */
async function loadBuildTarget(
  db: Kysely<KyselyDatabase> | KyselyTx,
  args: { companyId: string; projectId: string; parentId: string | null },
  lock: boolean
): Promise<BuildTarget> {
  let projectQuery = db
    .selectFrom("project")
    .select(["identifier", "nextElementSequence"])
    .where("id", "=", args.projectId)
    .where("companyId", "=", args.companyId);
  if (lock) projectQuery = projectQuery.forUpdate();
  const project = await projectQuery.executeTakeFirst();
  if (!project) throw new Error("The project does not exist");
  if (!project.identifier) throw new Error("The project has no identifier");

  const siblings = db
    .selectFrom("projectElement")
    .select(sql<number>`COALESCE(MAX("sortOrder"), 0)`.as("maxSortOrder"))
    .where("projectId", "=", args.projectId)
    .where("companyId", "=", args.companyId);
  const [states, parent, sortOrder] = await Promise.all([
    db
      .selectFrom("projectState")
      .select(["id", "group", "isDefault"])
      .where("projectId", "=", args.projectId)
      .where("companyId", "=", args.companyId)
      .orderBy("sortOrder", "asc")
      .execute(),
    args.parentId
      ? db
          .selectFrom("projectElement")
          .select("type")
          .where("id", "=", args.parentId)
          .where("projectId", "=", args.projectId)
          .where("companyId", "=", args.companyId)
          .executeTakeFirst()
      : Promise.resolve(null),
    (args.parentId
      ? siblings.where("parentId", "=", args.parentId)
      : siblings.where("parentId", "is", null)
    ).executeTakeFirstOrThrow()
  ]);
  if (args.parentId && !parent) {
    throw new Error("The parent element does not exist");
  }
  if (parent?.type === "Parameter") {
    throw new Error("A Parameter cannot have child elements");
  }
  return {
    identifier: project.identifier,
    startSequence: Number(project.nextElementSequence),
    startSortOrder: Number(sortOrder.maxSortOrder),
    states
  };
}

/**
 * The elements Build from part would create, with no insert: the Build from
 * part drawer's preview.
 */
export async function previewBuildFromPart(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: BuildFromPartArgs
): Promise<{ rows: BuildFromPartPreviewRow[]; skippedLines: number }> {
  const target = await loadBuildTarget(db, args, false);
  const plan = await planBuildFromPart(client, db, { ...args, ...target });
  return {
    rows: plan.rows.map((row) => ({
      id: row.id,
      parentId: row.parentId ?? null,
      type: row.type,
      name: row.name,
      readableId: row.readableId,
      itemId: (row.itemId as string | null | undefined) ?? null,
      trackedEntityId:
        (row.trackedEntityId as string | null | undefined) ?? null
    })),
    skippedLines: plan.skippedLines
  };
}

/** Rows per insert statement of a build. */
const BUILD_INSERT_CHUNK = 500;

/**
 * Creates elements under `parentId` from a serial's build history, an item's
 * make method or a template, in one transaction. It locks the project row,
 * numbers the elements from `nextElementSequence`, inserts them parents first
 * in chunks of 500 (a template's links after them), and advances the
 * sequence. Returns the number of elements created.
 */
export async function buildElementsFromPart(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: BuildFromPartArgs & { userId: string }
): Promise<{ count: number; skippedLines: number }> {
  return db.transaction().execute(async (trx) => {
    const target = await loadBuildTarget(trx, args, true);
    const plan = await planBuildFromPart(client, trx, { ...args, ...target });
    if (plan.rows.length === 0) {
      return { count: 0, skippedLines: plan.skippedLines };
    }

    const audit = {
      companyId: args.companyId,
      projectId: args.projectId,
      createdBy: args.userId
    };
    const insertRows = async (
      table: "projectElement" | "projectElementLink",
      rows: Record<string, unknown>[]
    ) => {
      for (let i = 0; i < rows.length; i += BUILD_INSERT_CHUNK) {
        await trx
          .insertInto(table as "projectElement")
          .values(
            rows
              .slice(i, i + BUILD_INSERT_CHUNK)
              .map((row) => ({ ...row, ...audit })) as never
          )
          .execute();
      }
    };
    await insertRows("projectElement", plan.rows);
    await insertRows("projectElementLink", plan.links);

    await trx
      .updateTable("project")
      .set({ nextElementSequence: target.startSequence + plan.rows.length })
      .where("id", "=", args.projectId)
      .where("companyId", "=", args.companyId)
      .execute();

    return { count: plan.rows.length, skippedLines: plan.skippedLines };
  });
}

export type ProjectVerification = {
  links: ProjectElementLink[];
  /** By element id: a Parameter's value or a Requirement's own status. */
  verification: Record<string, ElementVerification>;
  /** By Requirement id: the status rolled up over its child Requirements. */
  requirementStatus: Record<string, RequirementStatus>;
};

/**
 * Loads a project's trace links and computes the verification of its
 * Parameters and Requirements. Pass the unfiltered elements when the caller
 * already has them; a filtered list would leave out the inputs of a value.
 * The linked parts give their unit cost and custom field values
 * (`getProjectItemValues`).
 */
export async function getProjectVerification(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    projectId: string;
    elements?: VerificationElement[];
  }
): Promise<{ data: ProjectVerification | null; error: unknown }> {
  const [links, loaded] = await Promise.all([
    getProjectElementLinks(client, args.projectId, args.companyId),
    args.elements
      ? Promise.resolve({ data: args.elements, error: null })
      : getProjectElements(client, args.projectId, args.companyId)
  ]);
  if (links.error) return { data: null, error: links.error };
  if (loaded.error) return { data: null, error: loaded.error };
  const elements = (loaded.data ?? []) as VerificationElement[];

  const itemIds = elements
    .map((element) => element.itemId)
    .filter((id): id is string => Boolean(id));
  const itemValues = await getProjectItemValues(
    client,
    args.companyId,
    itemIds
  );
  if (itemValues.error) return { data: null, error: itemValues.error };

  const verification = computeVerification(
    elements,
    links.data ?? [],
    itemValues.data
  );
  return {
    data: {
      links: links.data ?? [],
      verification: Object.fromEntries(verification),
      requirementStatus: Object.fromEntries(
        rollUpRequirementStatus(elements, verification)
      )
    },
    error: null
  };
}

/**
 * Saves a Parameter's formula, in one transaction. It refuses a parse error,
 * a ref that is not a Parameter of the project, and a cycle of `feeds` links.
 * Then it sets the Formula source and replaces the element's incoming `feeds`
 * links with one link from each ref. Formula values recompute live, so the
 * links only record the dependency.
 */
export async function saveParameterFormula(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    elementId: string;
    formula: string;
    /** When set, the element must belong to this project. */
    projectId?: string;
  }
): Promise<{ error: string; position?: number } | { refs: string[] }> {
  const formula = args.formula.trim();
  const parsed = parseParameterFormula(formula);
  if ("error" in parsed) {
    return { error: parsed.error, position: parsed.position };
  }

  return db.transaction().execute(async (trx) => {
    const element = await trx
      .selectFrom("projectElement")
      .select(["id", "projectId", "type"])
      .where("id", "=", args.elementId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!element || (args.projectId && element.projectId !== args.projectId)) {
      return { error: "The element does not exist" };
    }
    if (element.type !== "Parameter") {
      return { error: "Only a Parameter has a formula" };
    }

    const targets =
      parsed.refs.length === 0
        ? []
        : await trx
            .selectFrom("projectElement")
            .select(["id", "readableId", "type"])
            .where("projectId", "=", element.projectId)
            .where("companyId", "=", args.companyId)
            .where("readableId", "in", parsed.refs)
            .execute();
    for (const ref of parsed.refs) {
      const target = targets.find((t) => t.readableId === ref);
      if (!target) return { error: `${ref} is not in this project` };
      if (target.type !== "Parameter") {
        return { error: `${ref} is a ${target.type}, not a Parameter` };
      }
      if (target.id === element.id) {
        return { error: "A formula cannot refer to its own Parameter" };
      }
    }

    // Walk the project's feeds links with the element's incoming links
    // replaced by the new refs. Reaching the element again is a cycle.
    const feeds = await trx
      .selectFrom("projectElementLink")
      .select(["fromElementId", "toElementId"])
      .where("projectId", "=", element.projectId)
      .where("companyId", "=", args.companyId)
      .where("linkType", "=", "feeds")
      .execute();
    const next = new Map<string, string[]>();
    const addEdge = (from: string, to: string) => {
      const list = next.get(from) ?? [];
      list.push(to);
      next.set(from, list);
    };
    for (const link of feeds) {
      if (link.toElementId !== element.id) {
        addEdge(link.fromElementId, link.toElementId);
      }
    }
    for (const target of targets) addEdge(target.id, element.id);
    const seen = new Set<string>();
    const stack = [...(next.get(element.id) ?? [])];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id === element.id) {
        return { error: "This formula would make a circular formula" };
      }
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(next.get(id) ?? []));
    }

    await trx
      .updateTable("projectElement")
      .set({
        parameterFormula: formula,
        parameterSource: "Formula",
        updatedBy: args.userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", element.id)
      .where("companyId", "=", args.companyId)
      .execute();

    await trx
      .deleteFrom("projectElementLink")
      .where("toElementId", "=", element.id)
      .where("linkType", "=", "feeds")
      .where("companyId", "=", args.companyId)
      .execute();

    if (targets.length > 0) {
      await trx
        .insertInto("projectElementLink")
        .values(
          targets.map((target) => ({
            companyId: args.companyId,
            projectId: element.projectId,
            fromElementId: target.id,
            toElementId: element.id,
            linkType: "feeds" as const,
            createdBy: args.userId
          }))
        )
        .execute();
    }

    return { refs: parsed.refs };
  });
}

/**
 * Moves an element under a new parent (or to the top level). Refuses a
 * parent that is the element itself or one of its descendants, and a
 * Parameter parent for an element that is not a Parameter.
 */
export async function moveProjectElement(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    projectId: string;
    elementId: string;
    parentId: string | null;
    sortOrder: number;
  }
) {
  return db.transaction().execute(async (trx) => {
    if (args.parentId) {
      if (args.parentId === args.elementId) {
        throw new Error("An element cannot be its own parent");
      }

      const descendant = await sql<{ id: string }>`
        WITH RECURSIVE subtree AS (
          SELECT "id" FROM "projectElement"
          WHERE "id" = ${args.elementId}
            AND "projectId" = ${args.projectId}
            AND "companyId" = ${args.companyId}
          UNION
          SELECT e."id" FROM "projectElement" e
          JOIN subtree s ON e."parentId" = s."id"
          WHERE e."projectId" = ${args.projectId}
            AND e."companyId" = ${args.companyId}
        )
        SELECT "id" FROM subtree WHERE "id" = ${args.parentId}
      `.execute(trx);
      if (descendant.rows.length > 0) {
        throw new Error("An element cannot move under one of its descendants");
      }

      const [parent, element] = await Promise.all([
        trx
          .selectFrom("projectElement")
          .select("type")
          .where("id", "=", args.parentId)
          .where("projectId", "=", args.projectId)
          .where("companyId", "=", args.companyId)
          .executeTakeFirst(),
        trx
          .selectFrom("projectElement")
          .select("type")
          .where("id", "=", args.elementId)
          .where("projectId", "=", args.projectId)
          .where("companyId", "=", args.companyId)
          .executeTakeFirst()
      ]);
      if (!parent) throw new Error("The parent element does not exist");
      // A Parameter's children are Parameters: they roll up into it.
      if (parent.type === "Parameter" && element?.type !== "Parameter") {
        throw new Error("A Parameter can only have Parameters as children");
      }
    }

    const moved = await trx
      .updateTable("projectElement")
      .set({
        parentId: args.parentId,
        sortOrder: args.sortOrder,
        updatedBy: args.userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", args.elementId)
      .where("projectId", "=", args.projectId)
      .where("companyId", "=", args.companyId)
      .returning("id")
      .executeTakeFirst();
    if (!moved) throw new Error("The element does not exist");
    return moved.id;
  });
}

/**
 * The first charge on an Unstarted element moves it to the project's
 * default Started state. Call it inside the charging transaction.
 */
export async function startElementOnFirstCharge(
  db: Kysely<KyselyDatabase> | KyselyTx,
  args: { companyId: string; projectElementId: string }
) {
  await sql`
    UPDATE "projectElement" e
    SET "stateId" = started."id",
        "updatedAt" = NOW()
    FROM "projectState" current, "projectState" started
    WHERE e."id" = ${args.projectElementId}
      AND e."companyId" = ${args.companyId}
      AND current."id" = e."stateId"
      AND current."companyId" = e."companyId"
      AND current."group" = 'Unstarted'
      AND started."projectId" = e."projectId"
      AND started."companyId" = e."companyId"
      AND started."group" = 'Started'
      AND started."isDefault"
  `.execute(db);
}

export type ProjectCostTotals = {
  budget: number;
  committed: number;
  actual: number;
};

/**
 * Sums `get_project_cost_summary` per project for a page of projects, in one
 * query. Budget is the plan material, labor and other cost. A project with no
 * rows gets zeros.
 */
export async function getProjectCostTotals(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; projectIds: string[] }
): Promise<Record<string, ProjectCostTotals>> {
  if (args.projectIds.length === 0) return {};

  const result = await sql<{
    projectId: string;
    budget: number | null;
    committed: number | null;
    actual: number | null;
  }>`
    SELECT p."id" AS "projectId",
      SUM(s."planMaterial" + s."planLabor" + s."planOther") AS "budget",
      SUM(s."committed") AS "committed",
      SUM(s."actual") AS "actual"
    FROM unnest(${args.projectIds}::text[]) AS p("id")
    CROSS JOIN LATERAL get_project_cost_summary(p."id", ${args.companyId}) s
    GROUP BY p."id"
  `.execute(db);

  return Object.fromEntries(
    result.rows.map((row) => [
      row.projectId,
      {
        budget: Number(row.budget ?? 0),
        committed: Number(row.committed ?? 0),
        actual: Number(row.actual ?? 0)
      }
    ])
  );
}

/**
 * Everything the element page (the peek and the full page) shows, read in
 * parallel: the element, every element of its project (for the children,
 * the parent pickers and the subtree roll-up), its comments, its plan lines,
 * the project's cost summary, the active labor categories, the subtree's
 * ledger rows and open time, and the user's default labor category. Returns
 * no data when the element does not exist or belongs to another project.
 */
export async function getProjectElementPage(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    projectId: string;
    elementId: string;
    userId: string;
    /** An element a change request adds: it has no row to read yet. */
    element?: ProjectElementRow;
  }
) {
  const [
    element,
    elements,
    comments,
    planLines,
    costSummary,
    laborCategories,
    employeeJob,
    timeAndMaterials
  ] = await Promise.all([
    args.element
      ? Promise.resolve({ data: args.element, error: null })
      : getProjectElement(client, args.elementId, args.companyId),
    getProjectElements(client, args.projectId, args.companyId),
    getProjectElementComments(client, args.elementId, args.companyId),
    getProjectElementPlanLines(client, args.elementId, args.companyId),
    getProjectCostSummary(client, args.projectId, args.companyId),
    getLaborCategoriesList(client, args.companyId),
    client
      .from("employeeJob")
      .select("laborCategoryId")
      .eq("id", args.userId)
      .eq("companyId", args.companyId)
      .maybeSingle(),
    getElementTimeAndMaterials(getDatabaseClient(), args)
  ]);

  const error =
    element.error ??
    elements.error ??
    comments.error ??
    planLines.error ??
    costSummary.error ??
    laborCategories.error ??
    employeeJob.error;
  if (error) return { data: null, error };
  if (!element.data || element.data.projectId !== args.projectId) {
    return { data: null, error: null };
  }

  const [verification, qualityDocuments, itemHistory] = await Promise.all([
    getProjectVerification(client, {
      companyId: args.companyId,
      projectId: args.projectId,
      elements: (elements.data ?? []) as VerificationElement[]
    }),
    // A Test Case names the quality procedure it runs.
    element.data.type === "Test Case"
      ? client
          .from("qualityDocument")
          .select("id, name, version")
          .eq("companyId", args.companyId)
          .order("name", { ascending: true })
          .order("version", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    // A linked part: what other elements on the same part have charged.
    element.data.itemId
      ? getElementHistoryByItem(client, args.companyId, element.data.itemId)
      : Promise.resolve({ data: null, error: null })
  ]);
  if (itemHistory.error) {
    logger.error("Failed to load the element history by part", {
      companyId: args.companyId,
      elementId: args.elementId,
      error: itemHistory.error
    });
  }
  if (verification.error || !verification.data) {
    return {
      data: null,
      error: (verification.error ?? new Error("No verification")) as Error
    };
  }
  if (qualityDocuments.error) {
    return { data: null, error: qualityDocuments.error };
  }

  // A Parameter reads the nearest linked part: offer its type's Numeric
  // custom fields as the Part field.
  let itemFields: { id: string; name: string }[] = [];
  if (element.data.type === "Parameter") {
    const byId = new Map((elements.data ?? []).map((e) => [e.id, e]));
    let current = byId.get(element.data.id);
    const seen = new Set<string>();
    let nearestItemId: string | null = null;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.itemId) {
        nearestItemId = current.itemId;
        break;
      }
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    if (nearestItemId) {
      const item = await client
        .from("item")
        .select("type")
        .eq("id", nearestItemId)
        .eq("companyId", args.companyId)
        .maybeSingle();
      if (item.error) return { data: null, error: item.error };
      if (item.data) {
        const fields = await getItemNumericCustomFields(
          client,
          args.companyId,
          item.data.type
        );
        if (fields.error) return { data: null, error: fields.error };
        itemFields = fields.data ?? [];
      }
    }
  }

  // A final asset's asset under construction (or in service), for its status.
  const capitalAsset = element.data.fixedAssetId
    ? await client
        .from("fixedAsset")
        .select("id, fixedAssetId, name, status")
        .eq("id", element.data.fixedAssetId)
        .eq("companyId", args.companyId)
        .maybeSingle()
    : null;
  if (capitalAsset?.error) return { data: null, error: capitalAsset.error };

  return {
    data: {
      element: element.data,
      capitalAsset: capitalAsset?.data ?? null,
      elements: elements.data ?? [],
      comments: comments.data ?? [],
      planLines: planLines.data ?? { materials: [], labor: [], costs: [] },
      costSummary: costSummary.data ?? [],
      laborCategories: laborCategories.data ?? [],
      defaultLaborCategoryId: employeeJob.data?.laborCategoryId ?? null,
      ledger: timeAndMaterials.ledger,
      openTime: timeAndMaterials.openTime,
      ...verification.data,
      qualityDocuments: qualityDocuments.data ?? [],
      itemFields,
      itemHistory: itemHistory.data ?? null
    },
    error: null
  };
}

export type ProjectElementPage = NonNullable<
  Awaited<ReturnType<typeof getProjectElementPage>>["data"]
>;

type ProjectElementRow = NonNullable<
  Awaited<ReturnType<typeof getProjectElement>>["data"]
>;

/**
 * The element page, with `changeRequestId` laid over it when set: the
 * element, the element list, its plan lines and the links show as the change
 * request would leave them, each row with its `changeOperation`. An element
 * the change request adds is built from its payload.
 */
export async function getProjectElementPageInChangeRequest(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    projectId: string;
    elementId: string;
    userId: string;
    changeRequestId: string | null;
  }
) {
  if (!args.changeRequestId) {
    const page = await getProjectElementPage(client, args);
    return page.data
      ? {
          data: {
            ...page.data,
            changeRequest: null,
            changeOperation: null as ChangeOperationMark
          },
          error: null
        }
      : { data: null, error: page.error };
  }

  const overlay = await loadChangeRequestOverlay(getDatabaseClient(), {
    companyId: args.companyId,
    projectId: args.projectId,
    changeRequestId: args.changeRequestId
  });
  if (!overlay) {
    return {
      data: null,
      error: new Error("The change request does not exist")
    };
  }

  const added = overlay.items.find(
    (item) =>
      item.operation === "Add" &&
      item.targetTable === "projectElement" &&
      item.targetId === args.elementId
  );
  let element: ProjectElementRow | undefined;
  if (added) {
    const row = overlay.overlay.elements.find((e) => e.id === args.elementId);
    if (!row) return { data: null, error: null };
    const payload = added.payload ?? {};
    const parentRow = row.parentId
      ? overlay.overlay.elements.find((e) => e.id === row.parentId)
      : undefined;
    const state = await client
      .from("projectState")
      .select("id, name, group, color")
      .eq("id", String(payload.stateId ?? ""))
      .eq("companyId", args.companyId)
      .maybeSingle();
    if (state.error) return { data: null, error: state.error };
    element = {
      ...payload,
      ...row,
      projectId: args.projectId,
      companyId: args.companyId,
      sequence: 0,
      completedAt: null,
      fixedAssetId: null,
      isFinalAsset: false,
      verdict: null,
      verdictAt: null,
      verdictBy: null,
      state: state.data,
      owner: null,
      milestone: null,
      labels: [],
      item: null,
      trackedEntity: null,
      parent: parentRow
        ? {
            id: parentRow.id,
            readableId: String(parentRow.readableId ?? ""),
            name: String(parentRow.name ?? "")
          }
        : null
    } as unknown as ProjectElementRow;
  }

  const page = await getProjectElementPage(client, { ...args, element });
  if (!page.data) return { data: null, error: page.error };

  const elements = await overlayElementList(
    client,
    overlay,
    page.data.elements,
    args
  );
  const planLines = await overlayPlanLines(
    client,
    overlay,
    page.data.planLines,
    args
  );
  const current = elements.find((e) => e.id === args.elementId);
  return {
    data: {
      ...page.data,
      element: current
        ? {
            ...page.data.element,
            ...pickPlanLayerFields("projectElement", current)
          }
        : page.data.element,
      changeOperation: (current?.changeOperation ??
        null) as ChangeOperationMark,
      elements,
      planLines,
      links: overlayLinkList(overlay, page.data.links),
      changeRequest: overlay.changeRequest
    },
    error: null
  };
}

const logger = getLogger("erp", "projects");

/**
 * Posts Submitted timesheet entries through the `post-timesheet` server
 * function. Returns an error message for the caller's flash, or null.
 * System: the caller has already authorized the change.
 */
export async function postTimesheetEntries(args: {
  timesheetEntryIds: string[];
  companyId: string;
  userId: string;
}): Promise<string | null> {
  if (args.timesheetEntryIds.length === 0) return null;
  const { timesheetEntryIds, companyId, userId } = args;
  const posting = await serverFns
    .system({ db: getDatabaseClient(), companyId, userId })
    .invoke("post-timesheet", { timesheetEntryIds });
  if (posting.error) {
    logger.error("Failed to post timesheet entries", {
      companyId,
      timesheetEntryIds,
      error: posting.error
    });
    return posting.error.message || "Failed to post the time";
  }
  return null;
}

/**
 * Issues stock to a project, or returns it, through the `post-project-issue`
 * server function. Returns an error message (a `ProjectChargeError` refusal
 * reads as its own message), or null.
 */
export async function postProjectIssue(
  args: z.infer<typeof projectIssueValidator> & {
    companyId: string;
    userId: string;
  }
): Promise<string | null> {
  const { companyId, userId, ...input } = args;
  const posting = await serverFns
    .system({ db: getDatabaseClient(), companyId, userId })
    .invoke("post-project-issue", {
      ...input,
      projectElementId: input.projectElementId ?? null,
      storageUnitId: input.storageUnitId ?? null,
      trackedEntityId: input.trackedEntityId ?? null
    });
  if (posting.error) {
    logger.error("Failed to post project issue", {
      companyId,
      projectId: input.projectId,
      error: posting.error
    });
    return posting.error.message || "Failed to issue the material";
  }
  return null;
}

/**
 * Logs time for one employee as a new timesheet entry: Submitted when it
 * goes straight to posting or waits for approval. A Kysely write, because
 * the employee's own RLS branch accepts only Draft rows.
 */
export async function logTimesheetEntry(
  db: Kysely<KyselyDatabase>,
  args: z.infer<typeof logTimeValidator> & {
    companyId: string;
    employeeId: string;
    userId: string;
  }
): Promise<string> {
  const now = datetime.timestamp();
  const row = await db
    .insertInto("timesheetEntry")
    .values({
      companyId: args.companyId,
      employeeId: args.employeeId,
      entryDate: args.entryDate,
      projectId: args.projectId,
      projectElementId: args.projectElementId ?? null,
      laborCategoryId: args.laborCategoryId,
      hours: args.hours,
      note: args.note ?? null,
      status: "Submitted",
      submittedAt: now,
      createdBy: args.userId,
      createdAt: now
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

export type ElementLedgerRow = {
  id: string;
  postingDate: string;
  costType: string;
  documentType: string;
  documentId: string;
  quantity: number | null;
  unitOfMeasureCode: string | null;
  amount: number;
  readableId: string | null;
};

export type ElementOpenTimeRow = {
  id: string;
  entryDate: string;
  employeeId: string;
  hours: number;
  status: string;
  readableId: string | null;
};

/** The most recent rows each list of the Time & materials section shows. */
const TIME_AND_MATERIALS_LIMIT = 200;

/**
 * The project ledger rows and the timesheet entries that are not Posted, of
 * an element and every element below it, newest first. Two queries, each
 * walking the subtree in SQL, so no id list leaves the database.
 */
export async function getElementTimeAndMaterials(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; projectId: string; elementId: string }
): Promise<{ ledger: ElementLedgerRow[]; openTime: ElementOpenTimeRow[] }> {
  const subtree = sql`
    WITH RECURSIVE subtree AS (
      SELECT "id" FROM "projectElement"
      WHERE "id" = ${args.elementId}
        AND "projectId" = ${args.projectId}
        AND "companyId" = ${args.companyId}
      UNION
      SELECT e."id" FROM "projectElement" e
      JOIN subtree s ON e."parentId" = s."id"
      WHERE e."projectId" = ${args.projectId}
        AND e."companyId" = ${args.companyId}
    )
  `;

  const [ledger, openTime] = await Promise.all([
    sql<ElementLedgerRow>`
      ${subtree}
      SELECT l."id", l."postingDate", l."costType", l."documentType",
        l."documentId", l."quantity", l."unitOfMeasureCode", l."amount",
        e."readableId"
      FROM "projectLedger" l
      JOIN subtree s ON s."id" = l."projectElementId"
      LEFT JOIN "projectElement" e
        ON e."id" = l."projectElementId" AND e."companyId" = l."companyId"
      WHERE l."companyId" = ${args.companyId}
        AND l."projectId" = ${args.projectId}
      ORDER BY l."postingDate" DESC, l."createdAt" DESC
      LIMIT ${TIME_AND_MATERIALS_LIMIT}
    `.execute(db),
    sql<ElementOpenTimeRow>`
      ${subtree}
      SELECT t."id", t."entryDate", t."employeeId", t."hours", t."status",
        e."readableId"
      FROM "timesheetEntry" t
      JOIN subtree s ON s."id" = t."projectElementId"
      LEFT JOIN "projectElement" e
        ON e."id" = t."projectElementId" AND e."companyId" = t."companyId"
      WHERE t."companyId" = ${args.companyId}
        AND t."projectId" = ${args.projectId}
        AND t."status" <> 'Posted'
      ORDER BY t."entryDate" DESC, t."createdAt" DESC
      LIMIT ${TIME_AND_MATERIALS_LIMIT}
    `.execute(db)
  ]);

  return {
    ledger: ledger.rows.map((row) => ({
      ...row,
      quantity: row.quantity === null ? null : Number(row.quantity),
      amount: Number(row.amount)
    })),
    openTime: openTime.rows.map((row) => ({
      ...row,
      hours: Number(row.hours)
    }))
  };
}

/** The form field of the `ChargeNumber` picker, for its field errors. */
const CHARGE_NUMBER_FIELD = "projectId__projectElementId";

/**
 * Checks the charge numbers of a document's lines in two queries: every
 * project is the company's, and every element belongs to its line's project.
 * Returns the first refusal, or null.
 */
export async function chargeNumbersError(
  client: SupabaseClient<Database>,
  companyId: string,
  refs: { projectId?: string | null; projectElementId?: string | null }[]
): Promise<string | null> {
  if (refs.some((ref) => ref.projectElementId && !ref.projectId)) {
    return "An element needs its project";
  }
  const projectIds = [
    ...new Set(refs.map((ref) => ref.projectId).filter(Boolean))
  ] as string[];
  const elementIds = [
    ...new Set(refs.map((ref) => ref.projectElementId).filter(Boolean))
  ] as string[];
  if (projectIds.length === 0) return null;

  const [projects, elements] = await Promise.all([
    client
      .from("project")
      .select("id")
      .eq("companyId", companyId)
      .in("id", projectIds),
    elementIds.length > 0
      ? client
          .from("projectElement")
          .select("id, projectId")
          .eq("companyId", companyId)
          .in("id", elementIds)
      : Promise.resolve({
          data: [] as { id: string; projectId: string }[],
          error: null
        })
  ]);
  if (projects.error || elements.error) {
    logger.error("Failed to check the charge numbers", {
      companyId,
      error: projects.error ?? elements.error
    });
    return "Failed to check the charge numbers";
  }
  const known = new Set((projects.data ?? []).map((row) => row.id));
  if (projectIds.some((id) => !known.has(id))) {
    return "The project does not exist";
  }
  const projectOf = new Map(
    (elements.data ?? []).map((row) => [row.id, row.projectId])
  );
  for (const ref of refs) {
    if (
      ref.projectElementId &&
      projectOf.get(ref.projectElementId) !== ref.projectId
    ) {
      return "The element is not part of the project";
    }
  }
  return null;
}

/**
 * Checks a charge number a form sends with a document (a job, a purchase
 * order line, a purchase invoice line): the project is this company's, the
 * element is one of its elements, and a job that consumes to the project has
 * an account to post to (not Statistical). Returns the field and refusal, or
 * null. Two reads at most.
 */
export async function chargeNumberError(
  client: SupabaseClient<Database>,
  companyId: string,
  args: {
    projectId?: string | null;
    projectElementId?: string | null;
    consumeToProject?: boolean;
  }
): Promise<{ field: string; message: string } | null> {
  if (!args.projectId) {
    if (args.projectElementId) {
      return {
        field: CHARGE_NUMBER_FIELD,
        message: "An element needs its project"
      };
    }
    return null;
  }

  const [project, element] = await Promise.all([
    client
      .from("project")
      .select("id, costTreatment")
      .eq("id", args.projectId)
      .eq("companyId", companyId)
      .maybeSingle(),
    args.projectElementId
      ? client
          .from("projectElement")
          .select("id")
          .eq("id", args.projectElementId)
          .eq("projectId", args.projectId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null
  ]);

  if (project.error || !project.data) {
    return {
      field: CHARGE_NUMBER_FIELD,
      message: "The project does not exist"
    };
  }
  if (element && (element.error || !element.data)) {
    return {
      field: CHARGE_NUMBER_FIELD,
      message: "The element is not part of the project"
    };
  }
  if (args.consumeToProject && project.data.costTreatment === "Statistical") {
    return {
      field: "consumeToProject",
      message:
        "A Statistical project has no account, so a job cannot consume to it"
    };
  }
  if (args.consumeToProject && project.data.costTreatment === "Capitalize") {
    return {
      field: "consumeToProject",
      message:
        "A capital project's job builds its asset under construction, so it cannot consume to the project"
    };
  }
  return null;
}
