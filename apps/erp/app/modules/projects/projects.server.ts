// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import { sql } from "kysely";
import type { z } from "zod";
import type {
  projectElementValidator,
  projectValidator
} from "./projects.models";
import { chargeableByDefault, defaultProjectStates } from "./projects.models";

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
      if (parent.type === "Parameter") {
        throw new Error("A Parameter cannot have child elements");
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

/**
 * Moves an element under a new parent (or to the top level). Refuses a
 * parent that is the element itself, one of its descendants, or a
 * Parameter.
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

      const parent = await trx
        .selectFrom("projectElement")
        .select("type")
        .where("id", "=", args.parentId)
        .where("projectId", "=", args.projectId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (!parent) throw new Error("The parent element does not exist");
      if (parent.type === "Parameter") {
        throw new Error("A Parameter cannot have child elements");
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
