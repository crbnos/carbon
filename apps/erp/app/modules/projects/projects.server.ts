// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { serverFns } from "@carbon/server-functions";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { customAlphabet } from "nanoid";
import type { z } from "zod";
import { getDatabaseClient } from "~/services/database.server";
import type {
  ElementVerification,
  ItemValues,
  logTimeValidator,
  ProjectCopyElement,
  ProjectCopySource,
  projectElementValidator,
  projectIssueValidator,
  projectValidator,
  RequirementStatus,
  VerificationElement
} from "./projects.models";
import {
  chargeableByDefault,
  computeVerification,
  defaultProjectStates,
  parseParameterFormula,
  planProjectCopy,
  rollUpRequirementStatus
} from "./projects.models";
import {
  getLaborCategoriesList,
  getProjectCostSummary,
  getProjectElement,
  getProjectElementComments,
  getProjectElementLinks,
  getProjectElementPlanLines,
  getProjectElements
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
 * The linked parts give their unit cost (`itemCost`).
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

  const itemIds = [
    ...new Set(
      elements
        .map((element) => element.itemId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  const itemValues = new Map<string, ItemValues>();
  if (itemIds.length > 0) {
    const costs = await client
      .from("itemCost")
      .select("itemId, unitCost")
      .in("itemId", itemIds)
      .eq("companyId", args.companyId);
    if (costs.error) return { data: null, error: costs.error };
    for (const cost of costs.data ?? []) {
      itemValues.set(cost.itemId, {
        unitCost: cost.unitCost === null ? null : Number(cost.unitCost),
        customFields: null
      });
    }
  }

  const verification = computeVerification(
    elements,
    links.data ?? [],
    itemValues
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
    getProjectElement(client, args.elementId, args.companyId),
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

  const [verification, qualityDocuments] = await Promise.all([
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
      : Promise.resolve({ data: [], error: null })
  ]);
  if (verification.error || !verification.data) {
    return {
      data: null,
      error: (verification.error ?? new Error("No verification")) as Error
    };
  }
  if (qualityDocuments.error) {
    return { data: null, error: qualityDocuments.error };
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
      qualityDocuments: qualityDocuments.data ?? []
    },
    error: null
  };
}

export type ProjectElementPage = NonNullable<
  Awaited<ReturnType<typeof getProjectElementPage>>["data"]
>;

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
