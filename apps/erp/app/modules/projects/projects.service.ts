// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database, Json } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { fetchAll } from "@carbon/database/fetch-all";
import { datetime } from "@carbon/utils";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { LIST_COUNT, setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { updateSortOrder } from "../shared/sort-order";
import type {
  ItemValues,
  laborCategoryRateValidator,
  laborCategoryValidator,
  ProjectCostTreatment,
  ProjectCostType,
  ProjectDisplayOptions,
  ProjectElementEditableField,
  ProjectElementFilterState,
  ProjectElementType,
  ProjectLayout,
  ProjectStateGroup,
  ProjectStatus,
  projectElementCostValidator,
  projectElementLaborValidator,
  projectElementLinkValidator,
  projectElementMaterialValidator,
  projectLabelValidator,
  projectMilestoneValidator,
  projectStateValidator,
  projectValidator,
  timesheetCellValidator
} from "./projects.models";
import {
  canLink,
  PARAMETER_ITEM_UNIT_COST,
  parameterSources,
  requirementCategories,
  requirementTargetOperators,
  requirementVerificationMethods,
  suspectLinkFields,
  testCaseVerdicts,
  typeSpecificElementFields,
  weekStartOf
} from "./projects.models";
import type { ProjectElementLink } from "./types";

type Client = SupabaseClient<Database>;

/** A refusal in the `{ data, error }` shape the routes already read. */
function refusal(message: string) {
  return {
    data: null,
    error: { message } as unknown as PostgrestError
  };
}

/** Purchase order statuses whose lines still count as open commitments. */
const CLOSED_PURCHASE_ORDER_STATUSES = ["Completed", "Closed", "Rejected"];

/** Job statuses that no longer take charges. */
const CLOSED_JOB_STATUSES = ["Completed", "Cancelled", "Closed"];

// --- Projects ----------------------------------------------------------------

/**
 * Deactivates a project. The row stays so its history still resolves.
 * @mcp delete
 */
export async function deleteProject(
  client: Client,
  companyId: string,
  projectId: string,
  updatedBy: string
) {
  return client
    .from("project")
    .update({
      active: false,
      updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", projectId)
    .eq("companyId", companyId)
    .select("id")
    .single();
}

/**
 * Gets one project.
 * @mcp read
 */
export async function getProject(
  client: Client,
  companyId: string,
  projectId: string
) {
  return client
    .from("project")
    .select("*")
    .eq("id", projectId)
    .eq("companyId", companyId)
    .single();
}

/**
 * Lists the active Standard projects of the company. A Service project
 * belongs to its service order and is listed in Service.
 * @mcp read
 */
export async function getProjects(
  client: Client,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    status?: ProjectStatus[] | null;
    costTreatment?: ProjectCostTreatment[] | null;
    ownerId?: string | null;
  }
) {
  let query = client
    .from("project")
    .select(
      "id, name, identifier, description, status, costTreatment, costAccountId, customerId, ownerId, locationId, startDate, endDate, priority, isTemplate, active, createdAt, createdBy, updatedAt, updatedBy",
      { count: LIST_COUNT }
    )
    .eq("companyId", companyId)
    .eq("projectType", "Standard")
    .eq("active", true);

  if (args.search) {
    query = query.or(
      `name.ilike.%${args.search}%,identifier.ilike.%${args.search}%,description.ilike.%${args.search}%`
    );
  }

  if (args.status && args.status.length > 0) {
    query = query.in("status", args.status);
  }

  if (args.costTreatment && args.costTreatment.length > 0) {
    query = query.in("costTreatment", args.costTreatment);
  }

  if (args.ownerId) {
    query = query.eq("ownerId", args.ownerId);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);

  return query;
}

type ProjectFields = Partial<Omit<z.infer<typeof projectValidator>, "id">> & {
  name: string;
};

/**
 * Creates or updates a project. A project created here gets no states; the
 * app creates projects with `createProject`, which seeds them.
 * @mcp upsert
 */
export async function upsertProject(
  client: Client,
  project:
    | (ProjectFields & {
        companyId: string;
        createdBy: string;
      })
    | (ProjectFields & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in project) {
    return client
      .from("project")
      .insert([{ ...project, active: true }])
      .select("id")
      .single();
  }

  const { companyId, id, ...update } = project;
  return client
    .from("project")
    .update({ ...sanitize(update), updatedAt: datetime.timestamp() })
    .eq("id", id)
    .eq("companyId", companyId)
    .select("id")
    .single();
}

/**
 * Updates the details of a project.
 * @mcp update
 */
export async function updateProject(
  client: Client,
  args: Partial<Omit<z.infer<typeof projectValidator>, "id">> & {
    id: string;
    companyId: string;
    updatedBy: string;
  }
) {
  const { id, companyId, ...update } = args;
  return client
    .from("project")
    .update({ ...sanitize(update), updatedAt: datetime.timestamp() })
    .eq("id", id)
    .eq("companyId", companyId)
    .select("id")
    .single();
}

/** Marks a project as a template, which the new project form lists first. */
export async function updateProjectTemplate(
  client: Client,
  args: {
    id: string;
    companyId: string;
    isTemplate: boolean;
    updatedBy: string;
  }
) {
  return client
    .from("project")
    .update({
      isTemplate: args.isTemplate,
      updatedBy: args.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

/**
 * Changes the status of a project. Closing refuses while the project has an
 * open purchase order line or an open job.
 * @mcp action
 */
export async function updateProjectStatus(
  client: Client,
  args: {
    id: string;
    companyId: string;
    status: ProjectStatus;
    updatedBy: string;
  }
) {
  if (args.status === "Closed") {
    const [openLines, openJobs] = await Promise.all([
      client
        .from("purchaseOrderLine")
        .select(
          "id, purchaseOrder!purchaseOrderLine_purchaseOrderId_fkey!inner(status)",
          { count: "exact", head: true }
        )
        .eq("projectId", args.id)
        .eq("companyId", args.companyId)
        .not(
          "purchaseOrder.status",
          "in",
          `(${CLOSED_PURCHASE_ORDER_STATUSES.map((s) => `"${s}"`).join(",")})`
        ),
      client
        .from("job")
        .select("id", { count: "exact", head: true })
        .eq("projectId", args.id)
        .eq("companyId", args.companyId)
        .not(
          "status",
          "in",
          `(${CLOSED_JOB_STATUSES.map((s) => `"${s}"`).join(",")})`
        )
    ]);

    if (openLines.error) return { data: null, error: openLines.error };
    if (openJobs.error) return { data: null, error: openJobs.error };

    if ((openLines.count ?? 0) > 0) {
      return refusal(
        `The project has ${openLines.count} open purchase order line(s). Receive or close them before you close the project.`
      );
    }
    if ((openJobs.count ?? 0) > 0) {
      return refusal(
        `The project has ${openJobs.count} open job(s). Complete or cancel them before you close the project.`
      );
    }
  }

  return client
    .from("project")
    .update({
      status: args.status,
      updatedBy: args.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

// --- Charge numbers ----------------------------------------------------------

export type ChargeNumber = {
  /** `projectId|` for the project itself, `projectId|elementId` for an element. */
  value: string;
  projectId: string;
  projectElementId: string | null;
  readableId: string;
  name: string;
  projectName: string;
  /** The project's cost treatment: Statistical cannot consume a job. */
  costTreatment: ProjectCostTreatment;
  /**
   * Capitalize only: the asset under construction a job of this charge
   * number builds (the element's own asset when it is a final asset, else
   * its nearest final-asset ancestor's, else the project's). Null otherwise.
   */
  targetFixedAssetId: string | null;
  /** `FA000012 — name` of the target asset, for display. */
  targetFixedAssetLabel: string | null;
};

/**
 * The Construction in Progress classes a capital project can build its
 * assets in. Read directly: `getFixedAssetClassesList` drops CIP classes while
 * `CONSTRUCTION_IN_PROGRESS_ENABLED` is false.
 */
export async function getCipFixedAssetClasses(
  client: Client,
  companyId: string
) {
  return client
    .from("fixedAssetClass")
    .select("id, name")
    .eq("companyId", companyId)
    .eq("isConstructionInProgress", true)
    .order("name");
}

/**
 * Lists what a user can charge: each Released project, and each chargeable
 * element of a Released project whose state is Unstarted or Started. When
 * the company requires an element, the project-only rows are left out.
 * @mcp read
 */
export async function getChargeNumbers(client: Client, companyId: string) {
  const [settings, projects, elements, capitalElements] = await Promise.all([
    client
      .from("companySettings")
      .select("requireProjectElement")
      .eq("id", companyId)
      .maybeSingle(),
    fetchAll<{
      id: string;
      identifier: string;
      name: string;
      costTreatment: ProjectCostTreatment;
      fixedAssetId: string | null;
    }>(() =>
      client
        .from("project")
        .select("id, identifier, name, costTreatment, fixedAssetId")
        .eq("companyId", companyId)
        .eq("projectType", "Standard")
        .eq("status", "Released")
        .eq("active", true)
        .order("identifier", { ascending: true })
    ),
    fetchAll<{
      id: string;
      projectId: string;
      readableId: string;
      name: string;
      project: { name: string; costTreatment: ProjectCostTreatment } | null;
    }>(() =>
      client
        .from("projectElement")
        .select(
          "id, projectId, readableId, name, project:project!projectElement_project_fkey!inner(name, costTreatment), state:projectState!projectElement_state_fkey!inner(group)"
        )
        .eq("companyId", companyId)
        .eq("isChargeable", true)
        .eq("project.projectType", "Standard")
        .eq("project.status", "Released")
        .eq("project.active", true)
        .in("state.group", ["Unstarted", "Started"])
        .order("projectId", { ascending: true })
        .order("sequence", { ascending: true })
    ),
    // Every element of a Released Capitalize project, for the nearest
    // final-asset walk.
    fetchAll<{
      id: string;
      parentId: string | null;
      isFinalAsset: boolean;
      fixedAssetId: string | null;
    }>(() =>
      client
        .from("projectElement")
        .select(
          "id, parentId, isFinalAsset, fixedAssetId, project:project!projectElement_project_fkey!inner(id)"
        )
        .eq("companyId", companyId)
        .eq("project.status", "Released")
        .eq("project.costTreatment", "Capitalize")
        .order("id", { ascending: true })
    )
  ]);

  if (settings.error) return { data: null, error: settings.error };
  if (projects.error) return { data: null, error: projects.error };
  if (elements.error) return { data: null, error: elements.error };
  if (capitalElements.error) {
    return { data: null, error: capitalElements.error };
  }

  const projectById = new Map(
    (projects.data ?? []).map((project) => [project.id, project])
  );
  const capitalElementById = new Map(
    (capitalElements.data ?? []).map((element) => [element.id, element])
  );
  const targetFixedAssetId = (
    projectId: string,
    elementId: string | null
  ): string | null => {
    const project = projectById.get(projectId);
    if (project?.costTreatment !== "Capitalize") return null;
    const seen = new Set<string>();
    let current = elementId ? capitalElementById.get(elementId) : undefined;
    while (current && !seen.has(current.id)) {
      if (current.isFinalAsset) return current.fixedAssetId;
      seen.add(current.id);
      current = current.parentId
        ? capitalElementById.get(current.parentId)
        : undefined;
    }
    return project.fixedAssetId;
  };

  const requireElement = settings.data?.requireProjectElement ?? false;

  const projectRows: ChargeNumber[] = requireElement
    ? []
    : (projects.data ?? []).map((project) => ({
        value: `${project.id}|`,
        projectId: project.id,
        projectElementId: null,
        readableId: project.identifier,
        name: project.name,
        projectName: project.name,
        costTreatment: project.costTreatment,
        targetFixedAssetId: targetFixedAssetId(project.id, null),
        targetFixedAssetLabel: null
      }));

  const elementRows: ChargeNumber[] = (elements.data ?? []).map((element) => ({
    value: `${element.projectId}|${element.id}`,
    projectId: element.projectId,
    projectElementId: element.id,
    readableId: element.readableId,
    name: element.name,
    projectName: element.project?.name ?? "",
    costTreatment: element.project?.costTreatment ?? "Statistical",
    targetFixedAssetId: targetFixedAssetId(element.projectId, element.id),
    targetFixedAssetLabel: null
  }));

  const rows = [...projectRows, ...elementRows];
  const targetIds = [
    ...new Set(
      rows
        .map((row) => row.targetFixedAssetId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  if (targetIds.length > 0) {
    const assets = await client
      .from("fixedAsset")
      .select("id, fixedAssetId, name")
      .in("id", targetIds)
      .eq("companyId", companyId);
    if (assets.error) return { data: null, error: assets.error };
    const labelById = new Map(
      assets.data.map((asset) => [
        asset.id,
        `${asset.fixedAssetId} — ${asset.name}`
      ])
    );
    for (const row of rows) {
      row.targetFixedAssetLabel = row.targetFixedAssetId
        ? (labelById.get(row.targetFixedAssetId) ?? null)
        : null;
    }
  }

  return { data: rows, error: null };
}

/**
 * The charge number of a purchase order line or a purchase invoice line. The
 * line views predate these columns, so they are read from the table.
 */
export async function getLineChargeNumber(
  client: Client,
  table: "purchaseOrderLine" | "purchaseInvoiceLine",
  id: string,
  companyId: string
) {
  return client
    .from(table)
    .select("projectId, projectElementId")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
}

// --- States ------------------------------------------------------------------

/**
 * Lists the workflow states of a project in board order.
 * @mcp read
 */
export async function getProjectStates(
  client: Client,
  projectId: string,
  companyId: string
) {
  return client
    .from("projectState")
    .select("*")
    .eq("projectId", projectId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true });
}

type ProjectStateFields = Omit<z.infer<typeof projectStateValidator>, "id">;

/**
 * Creates or updates a workflow state of a project. A new state goes after
 * the last state.
 * @mcp upsert
 */
export async function upsertProjectState(
  client: Client,
  state:
    | (ProjectStateFields & {
        projectId: string;
        companyId: string;
        createdBy: string;
      })
    | (ProjectStateFields & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in state) {
    const last = await client
      .from("projectState")
      .select("sortOrder")
      .eq("projectId", state.projectId)
      .eq("companyId", state.companyId)
      .order("sortOrder", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last.error) return { data: null, error: last.error };

    return client
      .from("projectState")
      .insert([
        {
          projectId: state.projectId,
          companyId: state.companyId,
          name: state.name,
          group: state.group,
          color: state.color,
          sortOrder: (last.data?.sortOrder ?? 0) + 1,
          createdBy: state.createdBy
        }
      ])
      .select("id")
      .single();
  }

  return client
    .from("projectState")
    .update({
      name: state.name,
      group: state.group,
      color: state.color,
      updatedBy: state.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", state.id)
    .eq("companyId", state.companyId)
    .select("id")
    .single();
}

/**
 * Deletes a workflow state of a project. Refuses when an element uses the
 * state or when it is the last state of its group. When the state is its
 * group's default, the next state of the group becomes the default.
 * @mcp delete
 */
export async function deleteProjectState(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; projectId: string; id: string }
) {
  try {
    await db.transaction().execute(async (trx) => {
      const state = await trx
        .selectFrom("projectState")
        .select(["id", "group", "isDefault"])
        .where("id", "=", args.id)
        .where("projectId", "=", args.projectId)
        .where("companyId", "=", args.companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!state) throw new Error("The state does not exist");

      const used = await trx
        .selectFrom("projectElement")
        .select("id")
        .where("stateId", "=", args.id)
        .where("companyId", "=", args.companyId)
        .limit(1)
        .executeTakeFirst();
      if (used) {
        throw new Error(
          "Elements use this state. Move them to another state first."
        );
      }

      const next = await trx
        .selectFrom("projectState")
        .select("id")
        .where("projectId", "=", args.projectId)
        .where("companyId", "=", args.companyId)
        .where("group", "=", state.group)
        .where("id", "<>", args.id)
        .orderBy("sortOrder", "asc")
        .limit(1)
        .executeTakeFirst();
      if (!next) {
        throw new Error(
          `This is the last ${state.group} state. A project needs one state in each group.`
        );
      }

      await trx
        .deleteFrom("projectState")
        .where("id", "=", args.id)
        .where("companyId", "=", args.companyId)
        .execute();

      if (state.isDefault) {
        await trx
          .updateTable("projectState")
          .set({ isDefault: true })
          .where("id", "=", next.id)
          .where("companyId", "=", args.companyId)
          .execute();
      }
    });
    return { data: { id: args.id }, error: null };
  } catch (err) {
    return refusal(
      err instanceof Error ? err.message : "Failed to delete the state"
    );
  }
}

/**
 * Makes a state the default of its group, in one transaction. The group's
 * previous default stops being the default. A new element of the group's
 * kind takes the default state.
 * @mcp update
 */
export async function setProjectStateDefault(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; projectId: string; id: string; updatedBy: string }
) {
  try {
    await db.transaction().execute(async (trx) => {
      const state = await trx
        .selectFrom("projectState")
        .select(["id", "group"])
        .where("id", "=", args.id)
        .where("projectId", "=", args.projectId)
        .where("companyId", "=", args.companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!state) throw new Error("The state does not exist");

      await trx
        .updateTable("projectState")
        .set({ isDefault: false })
        .where("projectId", "=", args.projectId)
        .where("companyId", "=", args.companyId)
        .where("group", "=", state.group)
        .where("isDefault", "=", true)
        .execute();

      await trx
        .updateTable("projectState")
        .set({
          isDefault: true,
          updatedBy: args.updatedBy,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", args.id)
        .where("companyId", "=", args.companyId)
        .execute();
    });
    return { data: { id: args.id }, error: null };
  } catch (err) {
    return refusal(
      err instanceof Error ? err.message : "Failed to set the default state"
    );
  }
}

// --- Labels ------------------------------------------------------------------

/**
 * Lists the labels of a project.
 * @mcp read
 */
export async function getProjectLabels(
  client: Client,
  projectId: string,
  companyId: string
) {
  return client
    .from("projectLabel")
    .select("*")
    .eq("projectId", projectId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("name", { ascending: true });
}

type ProjectLabelFields = Omit<z.infer<typeof projectLabelValidator>, "id">;

/**
 * Creates or updates a label of a project.
 * @mcp upsert
 */
export async function upsertProjectLabel(
  client: Client,
  label:
    | (ProjectLabelFields & {
        projectId: string;
        companyId: string;
        createdBy: string;
      })
    | (ProjectLabelFields & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in label) {
    return client
      .from("projectLabel")
      .insert([
        {
          projectId: label.projectId,
          companyId: label.companyId,
          name: label.name,
          color: label.color,
          createdBy: label.createdBy
        }
      ])
      .select("id")
      .single();
  }

  return client
    .from("projectLabel")
    .update({
      name: label.name,
      color: label.color,
      updatedBy: label.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", label.id)
    .eq("companyId", label.companyId)
    .select("id")
    .single();
}

/**
 * Deletes a label of a project. Its element links go with it.
 * @mcp delete
 */
export async function deleteProjectLabel(
  client: Client,
  id: string,
  companyId: string
) {
  return client
    .from("projectLabel")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

// --- Milestones --------------------------------------------------------------

/**
 * Lists the milestones of a project by date.
 * @mcp read
 */
export async function getProjectMilestones(
  client: Client,
  projectId: string,
  companyId: string
) {
  return client
    .from("projectMilestone")
    .select("*")
    .eq("projectId", projectId)
    .eq("companyId", companyId)
    .order("endDate", { ascending: true, nullsFirst: false })
    .order("sortOrder", { ascending: true });
}

type ProjectMilestoneFields = Omit<
  z.infer<typeof projectMilestoneValidator>,
  "id"
>;

/**
 * Creates or updates a milestone of a project.
 * @mcp upsert
 */
export async function upsertProjectMilestone(
  client: Client,
  milestone:
    | (ProjectMilestoneFields & {
        projectId: string;
        companyId: string;
        createdBy: string;
      })
    | (ProjectMilestoneFields & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in milestone) {
    return client
      .from("projectMilestone")
      .insert([
        {
          projectId: milestone.projectId,
          companyId: milestone.companyId,
          name: milestone.name,
          startDate: milestone.startDate ?? null,
          endDate: milestone.endDate ?? null,
          createdBy: milestone.createdBy
        }
      ])
      .select("id")
      .single();
  }

  return client
    .from("projectMilestone")
    .update({
      name: milestone.name,
      startDate: milestone.startDate ?? null,
      endDate: milestone.endDate ?? null,
      updatedBy: milestone.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", milestone.id)
    .eq("companyId", milestone.companyId)
    .select("id")
    .single();
}

/**
 * Completes a milestone now, or reopens it when `completed` is false.
 * @mcp update
 */
export async function completeProjectMilestone(
  client: Client,
  args: {
    id: string;
    companyId: string;
    completed: boolean;
    updatedBy: string;
  }
) {
  return client
    .from("projectMilestone")
    .update({
      completedAt: args.completed ? datetime.timestamp() : null,
      updatedBy: args.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .select("id, name, projectId")
    .single();
}

/**
 * Deletes a milestone of a project. Elements on it lose the milestone.
 * @mcp delete
 */
export async function deleteProjectMilestone(
  client: Client,
  id: string,
  companyId: string
) {
  return client
    .from("projectMilestone")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

// --- Baselines ---------------------------------------------------------------

const PROJECT_BASELINE_LIST_COLUMNS =
  "id, projectId, sequence, name, source, milestoneId, changeRequestId, formatVersion, elementCount, linkCount, createdBy, createdAt";

/**
 * Lists the baselines of a project, newest first, without their snapshots.
 * @mcp read
 */
export async function getProjectBaselines(
  client: Client,
  projectId: string,
  companyId: string
) {
  return client
    .from("projectBaseline")
    .select(PROJECT_BASELINE_LIST_COLUMNS)
    .eq("projectId", projectId)
    .eq("companyId", companyId)
    .order("sequence", { ascending: false });
}

/**
 * Loads one baseline with its plan snapshot.
 * @mcp read
 */
export async function getProjectBaseline(
  client: Client,
  id: string,
  companyId: string
) {
  return client
    .from("projectBaseline")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

// --- Change requests -----------------------------------------------------------

const PROJECT_CHANGE_REQUEST_LIST_COLUMNS =
  "id, projectId, readableId, title, status, submittedAt, decidedBy, decidedAt, appliedAt, baseBaselineId, appliedBaselineId, createdBy, createdAt, updatedAt, items:projectChangeRequestItem!projectChangeRequestItem_cr_fkey(count)";

/**
 * Lists the change requests of a project, newest first, with their item
 * counts.
 * @mcp read
 */
export async function getProjectChangeRequests(
  client: Client,
  projectId: string,
  companyId: string
) {
  return client
    .from("projectChangeRequest")
    .select(PROJECT_CHANGE_REQUEST_LIST_COLUMNS)
    .eq("projectId", projectId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false });
}

/**
 * Loads one change request with its title, reason, status and decision.
 * @mcp read
 */
export async function getProjectChangeRequest(
  client: Client,
  id: string,
  companyId: string
) {
  return client
    .from("projectChangeRequest")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

/** The names of the given labor categories, active or not (one `.in()`). */
export async function getLaborCategoryNames(
  client: Client,
  ids: string[],
  companyId: string
) {
  return client
    .from("laborCategory")
    .select("id, name")
    .eq("companyId", companyId)
    .in("id", ids);
}

// --- Elements ----------------------------------------------------------------

const PROJECT_ELEMENT_LIST_COLUMNS =
  "id, projectId, readableId, sequence, type, parentId, name, stateId, ownerId, priority, milestoneId, startDate, targetDate, completedAt, estimatedHours, isChargeable, budget, itemId, sortOrder, createdAt, updatedAt, requirementCategory, targetOperator, targetValue, targetUpperValue, targetUnit, verificationMethod, actualParameterId, qualityDocumentId, verdict, verdictAt, verdictBy, parameterValue, parameterUnit, parameterSource, parameterFormula, parameterItemField, parameterContingencyPercent, allocationPercent, state:projectState!projectElement_state_fkey!inner(name, group, color), labels:projectElementLabel!projectElementLabel_element_fkey(projectLabelId)" as const;

function projectElementsQuery(
  client: Client,
  projectId: string,
  companyId: string
) {
  return client
    .from("projectElement")
    .select(PROJECT_ELEMENT_LIST_COLUMNS)
    .eq("projectId", projectId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("id", { ascending: true });
}

export type ProjectElementListItem = NonNullable<
  Awaited<ReturnType<typeof projectElementsQuery>>["data"]
>[number];

/**
 * Lists every element of a project with its state and label ids. Pages
 * through the rows, because a project can have more than 1000 elements.
 * @mcp read
 */
export async function getProjectElements(
  client: Client,
  projectId: string,
  companyId: string,
  filters: {
    type?: ProjectElementType[] | null;
    stateGroup?: ProjectStateGroup[] | null;
    ownerId?: string[] | null;
    milestoneId?: string[] | null;
    labelId?: string[] | null;
    search?: string | null;
  } = {}
) {
  let labelledIds: string[] | null = null;
  if (filters.labelId && filters.labelId.length > 0) {
    const labelled = await client
      .from("projectElementLabel")
      .select("projectElementId")
      .in("projectLabelId", filters.labelId)
      .eq("companyId", companyId);
    if (labelled.error) return { data: null, error: labelled.error };
    labelledIds = [
      ...new Set((labelled.data ?? []).map((row) => row.projectElementId))
    ];
    if (labelledIds.length === 0) return { data: [], error: null };
  }

  return fetchAll<ProjectElementListItem>(() => {
    let query = projectElementsQuery(client, projectId, companyId);
    if (filters.type && filters.type.length > 0) {
      query = query.in("type", filters.type);
    }
    if (filters.stateGroup && filters.stateGroup.length > 0) {
      query = query.in("state.group", filters.stateGroup);
    }
    if (filters.ownerId && filters.ownerId.length > 0) {
      query = query.in("ownerId", filters.ownerId);
    }
    if (filters.milestoneId && filters.milestoneId.length > 0) {
      query = query.in("milestoneId", filters.milestoneId);
    }
    if (labelledIds) {
      query = query.in("id", labelledIds);
    }
    if (filters.search) {
      query = query.or(
        `name.ilike.%${filters.search}%,readableId.ilike.%${filters.search}%`
      );
    }
    return query;
  });
}

/**
 * The descriptions of every element of a project, for the Reader. The list
 * query leaves them out, because a description can be large.
 * @mcp read
 */
export async function getProjectElementDescriptions(
  client: Client,
  projectId: string,
  companyId: string
) {
  return fetchAll<{ id: string; description: Json | null }>(() =>
    client
      .from("projectElement")
      .select("id, description")
      .eq("projectId", projectId)
      .eq("companyId", companyId)
      .not("description", "is", null)
      .order("id", { ascending: true })
  );
}

/**
 * Gets one element with its state, owner, milestone, labels and parent.
 * @mcp read
 */
export async function getProjectElement(
  client: Client,
  id: string,
  companyId: string
) {
  const element = await client
    .from("projectElement")
    .select(
      "*, state:projectState!projectElement_state_fkey(id, name, group, color), owner:user!projectElement_ownerId_fkey(id, fullName, avatarUrl), milestone:projectMilestone!projectElement_milestone_fkey(id, name, endDate), labels:projectElementLabel!projectElementLabel_element_fkey(projectLabelId), item:item!projectElement_item_fkey(id, readableId, readableIdWithRevision, name, type, thumbnailPath, itemTrackingType), trackedEntity:trackedEntity!projectElement_trackedEntityId_fkey(id, readableId)"
    )
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  if (element.error || !element.data.parentId) {
    return element.error
      ? { data: null, error: element.error }
      : { data: { ...element.data, parent: null }, error: null };
  }

  // The parent is read on its own: a self-referencing embed is ambiguous.
  const parent = await client
    .from("projectElement")
    .select("id, readableId, name")
    .eq("id", element.data.parentId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (parent.error) return { data: null, error: parent.error };

  return { data: { ...element.data, parent: parent.data }, error: null };
}

type TypedElementRow = {
  id: string;
  projectId: string;
  readableId: string;
  type: ProjectElementType;
  targetValue: number | null;
  targetUpperValue: number | null;
  targetOperator:
    | Database["public"]["Enums"]["requirementTargetOperator"]
    | null;
  parameterFormula: string | null;
  parameterItemField: string | null;
};

function isOneOf<T extends string>(
  values: readonly T[],
  value: string
): value is T {
  return (values as readonly string[]).includes(value);
}

/** The element columns `suspectLinkFields` compares before a change. */
const SUSPECT_FIELD_COLUMNS =
  "id, name, description, targetOperator, targetValue, targetUpperValue, targetUnit, parameterValue, parameterUnit" as const;

/**
 * Sets one field on one or more elements. Moving into a Completed state
 * stamps `completedAt`; moving to any other state clears it. A change to a
 * field in `suspectLinkFields` makes the incoming trace links suspect.
 * @mcp update
 */
export async function updateProjectElementField(
  client: Client,
  args: {
    ids: string[];
    field: ProjectElementEditableField;
    value: string | null | undefined;
    companyId: string;
    updatedBy: string;
  }
) {
  const raw = args.value === undefined || args.value === "" ? null : args.value;
  const update: Database["public"]["Tables"]["projectElement"]["Update"] = {
    updatedBy: args.updatedBy,
    updatedAt: datetime.timestamp()
  };

  // A type-specific field (a Requirement's target, a Test Case's verdict, a
  // Parameter's value) is refused on an element of another type.
  const requiredType = typeSpecificElementFields[args.field];
  let typed: TypedElementRow[] = [];
  if (requiredType) {
    const elements = await client
      .from("projectElement")
      .select(
        "id, projectId, readableId, type, targetValue, targetUpperValue, targetOperator, parameterFormula, parameterItemField"
      )
      .in("id", args.ids)
      .eq("companyId", args.companyId);
    if (elements.error) return { data: null, error: elements.error };
    typed = elements.data;
    const other = typed.find((element) => element.type !== requiredType);
    if (other) {
      return refusal(
        `${other.readableId} is a ${other.type}, not a ${requiredType}`
      );
    }
  }
  const number = (min?: number, max?: number) => {
    if (raw === null) return { value: null };
    const value = Number(raw);
    if (
      !Number.isFinite(value) ||
      (min !== undefined && value < min) ||
      (max !== undefined && value > max)
    ) {
      return { error: true as const };
    }
    return { value };
  };

  switch (args.field) {
    case "name":
      if (!raw) return refusal("Name is required");
      update.name = raw;
      break;
    case "stateId": {
      if (!raw) return refusal("State is required");
      const state = await client
        .from("projectState")
        .select("group")
        .eq("id", raw)
        .eq("companyId", args.companyId)
        .single();
      if (state.error) return { data: null, error: state.error };
      update.stateId = raw;
      update.completedAt =
        state.data.group === "Completed" ? datetime.timestamp() : null;
      break;
    }
    case "priority":
      update.priority = (raw ??
        "None") as Database["public"]["Enums"]["projectElementPriority"];
      break;
    case "estimatedHours":
    case "budget": {
      const value = raw === null ? null : Number(raw);
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        return refusal("Enter a number of 0 or more");
      }
      update[args.field] = value;
      break;
    }
    case "isChargeable": {
      const value = raw === "true" || raw === "on";
      if (value) {
        const parameters = await client
          .from("projectElement")
          .select("id", { count: "exact", head: true })
          .in("id", args.ids)
          .eq("companyId", args.companyId)
          .eq("type", "Parameter");
        if (parameters.error) return { data: null, error: parameters.error };
        if ((parameters.count ?? 0) > 0) {
          return refusal("A Parameter cannot take charges");
        }
      }
      update.isChargeable = value;
      break;
    }
    case "isFinalAsset": {
      const value = raw === "true" || raw === "on";
      const elements = await client
        .from("projectElement")
        .select("id, readableId, type, fixedAssetId")
        .in("id", args.ids)
        .eq("companyId", args.companyId);
      if (elements.error) return { data: null, error: elements.error };
      if (value) {
        if (elements.data.some((element) => element.type === "Parameter")) {
          return refusal("A Parameter cannot be a final asset");
        }
      } else {
        // The asset's CIP costs would lose their element: refuse instead.
        const assetIds = elements.data
          .map((element) => element.fixedAssetId)
          .filter((id): id is string => Boolean(id));
        if (assetIds.length > 0) {
          const costs = await client
            .from("fixedAssetCipCost")
            .select("fixedAssetId")
            .in("fixedAssetId", assetIds)
            .eq("companyId", args.companyId)
            .limit(1);
          if (costs.error) return { data: null, error: costs.error };
          const withCost = elements.data.find(
            (element) => element.fixedAssetId === costs.data[0]?.fixedAssetId
          );
          if (withCost) {
            return refusal(
              `${withCost.readableId} has costs on its asset under construction. It stays a final asset.`
            );
          }
        }
      }
      update.isFinalAsset = value;
      break;
    }
    case "description": {
      try {
        update.description = raw === null ? null : (JSON.parse(raw) as Json);
      } catch {
        return refusal("The description is not valid");
      }
      break;
    }
    case "itemId":
    case "trackedEntityId": {
      // A Parameter links no part. A serial must be of the element's item;
      // the database trigger fills an empty item from the serial.
      const elements = await client
        .from("projectElement")
        .select("id, readableId, type, itemId")
        .in("id", args.ids)
        .eq("companyId", args.companyId);
      if (elements.error) return { data: null, error: elements.error };
      if (raw !== null && elements.data.some((e) => e.type === "Parameter")) {
        return refusal("A Parameter cannot link a part");
      }
      if (args.field === "itemId") {
        update.itemId = raw;
        // A new part drops the serial of the old one.
        update.trackedEntityId = null;
        break;
      }
      if (raw !== null) {
        const serial = await client
          .from("trackedEntity")
          .select("itemId")
          .eq("id", raw)
          .eq("companyId", args.companyId)
          .maybeSingle();
        if (serial.error) return { data: null, error: serial.error };
        if (!serial.data?.itemId) {
          return refusal("The serial has no item in this company");
        }
        const other = elements.data.find(
          (e) => e.itemId !== null && e.itemId !== serial.data?.itemId
        );
        if (other) {
          return refusal(
            `The serial belongs to a different item than ${other.readableId}`
          );
        }
      }
      update.trackedEntityId = raw;
      break;
    }
    case "ownerId":
    case "milestoneId":
    case "startDate":
    case "targetDate":
    case "targetUnit":
    case "parameterUnit":
    case "qualityDocumentId":
      update[args.field] = raw;
      break;
    case "requirementCategory":
      if (raw !== null && !isOneOf(requirementCategories, raw)) {
        return refusal("Choose a requirement category");
      }
      update.requirementCategory = raw;
      break;
    case "verificationMethod":
      if (raw !== null && !isOneOf(requirementVerificationMethods, raw)) {
        return refusal("Choose a verification method");
      }
      update.verificationMethod = raw;
      break;
    case "targetOperator": {
      if (raw !== null && !isOneOf(requirementTargetOperators, raw)) {
        return refusal("Choose a target operator");
      }
      update.targetOperator = raw;
      // A Range needs an upper value: start it at the target.
      if (raw === "Range") {
        const open = typed.filter((e) => e.targetUpperValue === null);
        if (open.length > 0 && typed.length > 1) {
          return refusal("Set the upper value of each Requirement first");
        }
        if (open.length > 0) {
          update.targetUpperValue = Number(open[0]!.targetValue ?? 0);
        }
      }
      break;
    }
    case "targetValue":
    case "targetUpperValue":
    case "parameterValue": {
      const result = number();
      if ("error" in result) return refusal("Enter a number");
      if (
        args.field === "targetUpperValue" &&
        result.value === null &&
        typed.some((e) => e.targetOperator === "Range")
      ) {
        return refusal("A range needs an upper value");
      }
      update[args.field] = result.value;
      break;
    }
    case "parameterContingencyPercent":
    case "allocationPercent": {
      const result = number(0, 1);
      if ("error" in result) return refusal("Enter a percent from 0 to 100");
      update[args.field] = result.value;
      break;
    }
    case "actualParameterId": {
      if (raw !== null) {
        const parameter = await client
          .from("projectElement")
          .select("type, projectId")
          .eq("id", raw)
          .eq("companyId", args.companyId)
          .maybeSingle();
        if (parameter.error) return { data: null, error: parameter.error };
        if (
          parameter.data?.type !== "Parameter" ||
          typed.some((e) => e.projectId !== parameter.data?.projectId)
        ) {
          return refusal("Choose a Parameter of this project");
        }
      }
      update.actualParameterId = raw;
      break;
    }
    case "verdict":
      if (raw !== null && !isOneOf(testCaseVerdicts, raw)) {
        return refusal("Choose a verdict");
      }
      update.verdict = raw;
      update.verdictAt = raw === null ? null : datetime.timestamp();
      update.verdictBy = raw === null ? null : args.updatedBy;
      break;
    case "parameterSource": {
      if (raw !== null && !isOneOf(parameterSources, raw)) {
        return refusal("Choose a source");
      }
      // The formula save sets the Formula source, with its feeds links. A
      // Parameter that leaves Formula keeps its formula and links, so it can
      // go back; only the Formula source reads them.
      if (raw === "Formula" && typed.some((e) => !e.parameterFormula)) {
        return refusal(
          "Enter the formula. Saving it sets the source to Formula."
        );
      }
      if (raw === "Item" && typed.some((e) => !e.parameterItemField)) {
        update.parameterItemField = PARAMETER_ITEM_UNIT_COST;
      }
      update.parameterSource = raw;
      break;
    }
    case "parameterItemField":
      if (raw === null) return refusal("Choose an item field");
      update.parameterItemField = raw;
      break;
  }

  // A change to a reviewed field makes the incoming links suspect. Read the
  // old values first, so a save with the same value marks nothing.
  const marksSuspect = suspectLinkFields.includes(args.field);
  let changedIds: string[] = [];
  if (marksSuspect) {
    const before = await client
      .from("projectElement")
      .select(SUSPECT_FIELD_COLUMNS)
      .in("id", args.ids)
      .eq("companyId", args.companyId);
    if (before.error) return { data: null, error: before.error };
    const field = args.field as keyof typeof update;
    const next = JSON.stringify(update[field] ?? null);
    changedIds = before.data
      .filter(
        (row) => JSON.stringify(row[field as keyof typeof row] ?? null) !== next
      )
      .map((row) => row.id);
  }

  const result = await client
    .from("projectElement")
    .update(update)
    .in("id", args.ids)
    .eq("companyId", args.companyId)
    .select("id");
  if (result.error) return result;

  if (changedIds.length === 0) return result;

  // A `feeds` link never turns suspect: a formula recomputes live. A link
  // that is already suspect keeps the time it first turned suspect.
  const suspect = await client
    .from("projectElementLink")
    .update({ suspectSince: datetime.timestamp() })
    .in("toElementId", changedIds)
    .neq("linkType", "feeds")
    .is("suspectSince", null)
    .eq("companyId", args.companyId);
  if (suspect.error) return { data: null, error: suspect.error };

  return result;
}

/**
 * Replaces the labels of an element with the given set.
 * @mcp action destructive
 */
export async function setProjectElementLabels(
  client: Client,
  args: {
    projectElementId: string;
    labelIds: string[];
    companyId: string;
    createdBy: string;
  }
) {
  const existing = await client
    .from("projectElementLabel")
    .select("projectLabelId")
    .eq("projectElementId", args.projectElementId)
    .eq("companyId", args.companyId);
  if (existing.error) return { data: null, error: existing.error };

  const current = new Set(
    (existing.data ?? []).map((row) => row.projectLabelId)
  );
  const wanted = new Set(args.labelIds);
  const removed = [...current].filter((id) => !wanted.has(id));
  const added = [...wanted].filter((id) => !current.has(id));

  if (removed.length > 0) {
    const deleted = await client
      .from("projectElementLabel")
      .delete()
      .eq("projectElementId", args.projectElementId)
      .eq("companyId", args.companyId)
      .in("projectLabelId", removed);
    if (deleted.error) return { data: null, error: deleted.error };
  }

  if (added.length > 0) {
    const inserted = await client.from("projectElementLabel").insert(
      added.map((projectLabelId) => ({
        projectElementId: args.projectElementId,
        projectLabelId,
        companyId: args.companyId,
        createdBy: args.createdBy
      }))
    );
    if (inserted.error) return { data: null, error: inserted.error };
  }

  return { data: { added, removed }, error: null };
}

/**
 * Saves the drag-sort order of sibling elements.
 * @mcp update
 */
export async function updateProjectElementOrder(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  userId: string,
  projectId: string,
  updates: { id: string; sortOrder: number }[]
) {
  return updateSortOrder(db, {
    table: "projectElement",
    column: "sortOrder",
    companyId,
    userId,
    parent: { column: "projectId", id: projectId },
    updates
  });
}

/**
 * Deletes an element and its descendants. Refuses when the element or a
 * descendant has a project ledger row, a timesheet entry, a job or a
 * purchase order line.
 * @mcp delete destructive
 */
export async function deleteProjectElement(
  client: Client,
  id: string,
  companyId: string
) {
  const element = await client
    .from("projectElement")
    .select("id, projectId")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  if (element.error) return { data: null, error: element.error };

  const all = await fetchAll<{ id: string; parentId: string | null }>(() =>
    client
      .from("projectElement")
      .select("id, parentId")
      .eq("projectId", element.data.projectId)
      .eq("companyId", companyId)
      .order("id", { ascending: true })
  );
  if (all.error) {
    return { data: null, error: all.error as unknown as PostgrestError };
  }

  const childrenOf = new Map<string, string[]>();
  for (const row of all.data ?? []) {
    if (!row.parentId) continue;
    const children = childrenOf.get(row.parentId) ?? [];
    children.push(row.id);
    childrenOf.set(row.parentId, children);
  }
  const subtree: string[] = [];
  const stack = [id];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    subtree.push(next);
    stack.push(...(childrenOf.get(next) ?? []));
  }

  const [ledger, timesheets, jobs, purchaseLines] = await Promise.all([
    client
      .from("projectLedger")
      .select("id", { count: "exact", head: true })
      .in("projectElementId", subtree)
      .eq("companyId", companyId),
    client
      .from("timesheetEntry")
      .select("id", { count: "exact", head: true })
      .in("projectElementId", subtree)
      .eq("companyId", companyId),
    client
      .from("job")
      .select("id", { count: "exact", head: true })
      .in("projectElementId", subtree)
      .eq("companyId", companyId),
    client
      .from("purchaseOrderLine")
      .select("id", { count: "exact", head: true })
      .in("projectElementId", subtree)
      .eq("companyId", companyId)
  ]);
  for (const result of [ledger, timesheets, jobs, purchaseLines]) {
    if (result.error) return { data: null, error: result.error };
  }
  if ((ledger.count ?? 0) > 0) {
    return refusal(
      "Costs are posted to this element or an element below it. It cannot be deleted."
    );
  }
  if ((timesheets.count ?? 0) > 0) {
    return refusal(
      "Time is logged on this element or an element below it. It cannot be deleted."
    );
  }
  if ((jobs.count ?? 0) > 0) {
    return refusal(
      "A job charges this element or an element below it. It cannot be deleted."
    );
  }
  if ((purchaseLines.count ?? 0) > 0) {
    return refusal(
      "A purchase order line charges this element or an element below it. It cannot be deleted."
    );
  }

  // The parent FK cascades, so the descendants go with the element.
  return client
    .from("projectElement")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

// --- Trace links -------------------------------------------------------------

/** The item types whose typed table carries the part's custom field values. */
const ITEM_VALUE_TABLES = {
  Part: "part",
  Material: "material",
  Tool: "tool",
  Consumable: "consumable"
} as const;

type ItemValueTable =
  (typeof ITEM_VALUE_TABLES)[keyof typeof ITEM_VALUE_TABLES];

/** `attributeDataType.id` of the Numeric custom field type. */
const NUMERIC_CUSTOM_FIELD_TYPE = 4;

/**
 * The values a Parameter reads from a linked part: the unit cost
 * (`itemCost`) and the custom field values, keyed by `customField.id`. The
 * custom fields live on the typed item table (`part`, `material`, `tool`,
 * `consumable`), whose `id` is the item's `readableId`. At most 6 queries for
 * any number of items. Values stay as stored (form data stores strings);
 * `computeVerification` parses them.
 * @mcp read
 */
export async function getProjectItemValues(
  client: Client,
  companyId: string,
  itemIds: string[]
): Promise<{ data: Map<string, ItemValues>; error: PostgrestError | null }> {
  const values = new Map<string, ItemValues>();
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) return { data: values, error: null };

  const [items, costs] = await Promise.all([
    client
      .from("item")
      .select("id, readableId, type")
      .in("id", ids)
      .eq("companyId", companyId),
    client
      .from("itemCost")
      .select("itemId, unitCost")
      .in("itemId", ids)
      .eq("companyId", companyId)
  ]);
  if (items.error) return { data: values, error: items.error };
  if (costs.error) return { data: values, error: costs.error };

  const readableIdsByTable = new Map<ItemValueTable, Set<string>>();
  for (const item of items.data ?? []) {
    const table =
      ITEM_VALUE_TABLES[item.type as keyof typeof ITEM_VALUE_TABLES];
    if (!table || !item.readableId) continue;
    const set = readableIdsByTable.get(table) ?? new Set<string>();
    set.add(item.readableId);
    readableIdsByTable.set(table, set);
  }

  const typed = await Promise.all(
    [...readableIdsByTable].map(async ([table, readableIds]) => {
      const result = await client
        .from(table as "part")
        .select("id, customFields")
        .in("id", [...readableIds])
        .eq("companyId", companyId);
      return { table, result };
    })
  );
  const customFieldsByKey = new Map<string, Record<string, unknown>>();
  for (const { table, result } of typed) {
    if (result.error) return { data: values, error: result.error };
    for (const row of result.data ?? []) {
      const fields = row.customFields;
      if (fields && typeof fields === "object" && !Array.isArray(fields)) {
        customFieldsByKey.set(
          `${table}:${row.id}`,
          fields as Record<string, unknown>
        );
      }
    }
  }

  const unitCostById = new Map(
    (costs.data ?? []).map((cost) => [
      cost.itemId,
      cost.unitCost === null ? null : Number(cost.unitCost)
    ])
  );
  for (const item of items.data ?? []) {
    const table =
      ITEM_VALUE_TABLES[item.type as keyof typeof ITEM_VALUE_TABLES];
    values.set(item.id, {
      unitCost: unitCostById.get(item.id) ?? null,
      customFields:
        (table && item.readableId
          ? customFieldsByKey.get(`${table}:${item.readableId}`)
          : undefined) ?? null
    });
  }
  return { data: values, error: null };
}

/**
 * What the elements linked to an item have charged, averaged per element:
 * labor hours, material cost and the last posting date
 * (`get_element_history_by_item`). Only elements with a ledger row count.
 * @mcp read
 */
export async function getElementHistoryByItem(
  client: Client,
  companyId: string,
  itemId: string
) {
  return client
    .rpc("get_element_history_by_item", {
      p_company_id: companyId,
      p_item_id: itemId
    })
    .single();
}

/**
 * The active Numeric custom fields of an item type, for a Parameter's
 * **Part field**. A type with no typed custom field table has none.
 * @mcp read
 */
export async function getItemNumericCustomFields(
  client: Client,
  companyId: string,
  itemType: Database["public"]["Enums"]["itemType"]
) {
  const table = ITEM_VALUE_TABLES[itemType as keyof typeof ITEM_VALUE_TABLES];
  if (!table) return { data: [], error: null };
  return client
    .from("customField")
    .select("id, name")
    .eq("table", table)
    .eq("dataTypeId", NUMERIC_CUSTOM_FIELD_TYPE)
    .eq("companyId", companyId)
    .not("active", "is", false)
    .order("sortOrder", { ascending: true });
}

/**
 * Lists every trace link of a project. Pages through the rows, because a
 * large project can have more than 1000 links.
 * @mcp read
 */
export async function getProjectElementLinks(
  client: Client,
  projectId: string,
  companyId: string
) {
  return fetchAll<ProjectElementLink>(() =>
    client
      .from("projectElementLink")
      .select("*")
      .eq("projectId", projectId)
      .eq("companyId", companyId)
      .order("id", { ascending: true })
  );
}

/**
 * Adds a trace link between two elements of one project. `canLink` decides,
 * with the project's links loaded once: a `feeds` link is refused, because
 * only a formula save writes them.
 * @mcp create
 */
export async function upsertProjectElementLink(
  client: Client,
  args: z.infer<typeof projectElementLinkValidator> & {
    projectId: string;
    companyId: string;
    createdBy: string;
  }
) {
  const [elements, links] = await Promise.all([
    client
      .from("projectElement")
      .select("id, type")
      .in("id", [args.fromElementId, args.toElementId])
      .eq("projectId", args.projectId)
      .eq("companyId", args.companyId),
    getProjectElementLinks(client, args.projectId, args.companyId)
  ]);
  if (elements.error) return { data: null, error: elements.error };
  if (links.error) {
    return { data: null, error: links.error as unknown as PostgrestError };
  }

  const from = elements.data.find((e) => e.id === args.fromElementId);
  const to = elements.data.find((e) => e.id === args.toElementId);
  if (!from || !to) return refusal("Both elements must be in this project");

  const check = canLink(from, to, args.linkType, links.data ?? []);
  if (!check.ok) return refusal(check.reason);

  return client
    .from("projectElementLink")
    .insert({
      projectId: args.projectId,
      fromElementId: args.fromElementId,
      toElementId: args.toElementId,
      linkType: args.linkType,
      companyId: args.companyId,
      createdBy: args.createdBy
    })
    .select("id")
    .single();
}

/**
 * Deletes a trace link. A `feeds` link belongs to a formula and is refused:
 * edit the formula instead.
 * @mcp delete
 */
export async function deleteProjectElementLink(
  client: Client,
  id: string,
  companyId: string
) {
  const link = await client
    .from("projectElementLink")
    .select("linkType")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  if (link.error) return { data: null, error: link.error };
  if (link.data.linkType === "feeds") {
    return refusal("A formula writes this link. Edit the formula instead.");
  }

  return client
    .from("projectElementLink")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

/**
 * Marks a suspect link reviewed: clears `suspectSince` and records who
 * reviewed it and when.
 * @mcp update
 */
export async function clearSuspectLink(
  client: Client,
  args: { id: string; companyId: string; userId: string }
) {
  const now = datetime.timestamp();
  return client
    .from("projectElementLink")
    .update({
      suspectSince: null,
      reviewedAt: now,
      reviewedBy: args.userId,
      updatedBy: args.userId,
      updatedAt: now
    })
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .select("id");
}

// --- Element comments --------------------------------------------------------

/**
 * Lists the comments on an element, oldest first.
 * @mcp read
 */
export async function getProjectElementComments(
  client: Client,
  projectElementId: string,
  companyId: string
) {
  return client
    .from("projectElementComment")
    .select(
      "id, content, createdAt, updatedAt, createdBy:user!projectElementComment_createdBy_fkey(id, fullName, avatarUrl)"
    )
    .eq("projectElementId", projectElementId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true });
}

/**
 * Adds a comment to an element. `content` is the editor's JSON document.
 * @mcp create
 */
export async function insertProjectElementComment(
  client: Client,
  args: {
    projectElementId: string;
    content: string;
    companyId: string;
    createdBy: string;
  }
) {
  let content: Json;
  try {
    content = JSON.parse(args.content) as Json;
  } catch {
    return refusal("The comment is not valid");
  }
  return client
    .from("projectElementComment")
    .insert([
      {
        projectElementId: args.projectElementId,
        content,
        companyId: args.companyId,
        createdBy: args.createdBy
      }
    ])
    .select("id")
    .single();
}

/**
 * Deletes a comment on an element. Only its author can delete it.
 * @mcp delete
 */
export async function deleteProjectElementComment(
  client: Client,
  id: string,
  companyId: string,
  userId: string
) {
  const deleted = await client
    .from("projectElementComment")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId)
    .eq("createdBy", userId)
    .select("id");
  if (deleted.error) return { data: null, error: deleted.error };
  if ((deleted.data ?? []).length === 0) {
    return refusal("Only the author can delete a comment");
  }
  return { data: deleted.data, error: null };
}

// --- Plan lines --------------------------------------------------------------

/**
 * Gets the material, labor and other-cost plan lines of an element.
 * @mcp read
 */
export async function getProjectElementPlanLines(
  client: Client,
  projectElementId: string,
  companyId: string
) {
  const [materials, labor, costs] = await Promise.all([
    client
      .from("projectElementMaterial")
      .select(
        "*, item:item!projectElementMaterial_itemId_fkey(id, readableIdWithRevision, name), job:job!projectElementMaterial_jobId_fkey(id, jobId), purchaseOrderLine:purchaseOrderLine!projectElementMaterial_purchaseOrderLineId_fkey(id, purchaseOrder:purchaseOrder!purchaseOrderLine_purchaseOrderId_fkey(id, purchaseOrderId))"
      )
      .eq("projectElementId", projectElementId)
      .eq("companyId", companyId)
      .order("createdAt", { ascending: true }),
    client
      .from("projectElementLabor")
      .select(
        "*, laborCategory:laborCategory!projectElementLabor_category_fkey(id, name)"
      )
      .eq("projectElementId", projectElementId)
      .eq("companyId", companyId)
      .order("createdAt", { ascending: true }),
    client
      .from("projectElementCost")
      .select("*")
      .eq("projectElementId", projectElementId)
      .eq("companyId", companyId)
      .order("createdAt", { ascending: true })
  ]);

  const error = materials.error ?? labor.error ?? costs.error;
  if (error) return { data: null, error };

  return {
    data: {
      materials: materials.data ?? [],
      labor: labor.data ?? [],
      costs: costs.data ?? []
    },
    error: null
  };
}

type MaterialFields = Omit<
  z.infer<typeof projectElementMaterialValidator>,
  "id"
>;

/**
 * Creates or updates a material plan line of an element.
 * @mcp upsert
 */
export async function upsertProjectElementMaterial(
  client: Client,
  line:
    | (MaterialFields & {
        projectId: string;
        companyId: string;
        createdBy: string;
      })
    | (MaterialFields & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
) {
  const fields = {
    itemId: line.itemId,
    methodType: line.methodType,
    quantity: line.quantity,
    unitOfMeasureCode: line.unitOfMeasureCode ?? null,
    unitCost: line.unitCost ?? null,
    requiredDate: line.requiredDate ?? null
  };
  if ("createdBy" in line) {
    return client
      .from("projectElementMaterial")
      .insert([
        {
          ...fields,
          projectId: line.projectId,
          projectElementId: line.projectElementId,
          companyId: line.companyId,
          createdBy: line.createdBy
        }
      ])
      .select("id")
      .single();
  }
  return client
    .from("projectElementMaterial")
    .update({
      ...fields,
      updatedBy: line.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", line.id)
    .eq("companyId", line.companyId)
    .select("id")
    .single();
}

/**
 * Deletes a material plan line.
 * @mcp delete
 */
export async function deleteProjectElementMaterial(
  client: Client,
  id: string,
  companyId: string
) {
  return client
    .from("projectElementMaterial")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

type LaborFields = Omit<z.infer<typeof projectElementLaborValidator>, "id">;

/**
 * Creates or updates a labor plan line of an element.
 * @mcp upsert
 */
export async function upsertProjectElementLabor(
  client: Client,
  line:
    | (LaborFields & {
        projectId: string;
        companyId: string;
        createdBy: string;
      })
    | (LaborFields & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
) {
  const fields = {
    laborCategoryId: line.laborCategoryId,
    hours: line.hours,
    startDate: line.startDate ?? null,
    endDate: line.endDate ?? null
  };
  if ("createdBy" in line) {
    return client
      .from("projectElementLabor")
      .insert([
        {
          ...fields,
          projectId: line.projectId,
          projectElementId: line.projectElementId,
          companyId: line.companyId,
          createdBy: line.createdBy
        }
      ])
      .select("id")
      .single();
  }
  return client
    .from("projectElementLabor")
    .update({
      ...fields,
      updatedBy: line.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", line.id)
    .eq("companyId", line.companyId)
    .select("id")
    .single();
}

/**
 * Deletes a labor plan line.
 * @mcp delete
 */
export async function deleteProjectElementLabor(
  client: Client,
  id: string,
  companyId: string
) {
  return client
    .from("projectElementLabor")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

type CostFields = Omit<z.infer<typeof projectElementCostValidator>, "id">;

/**
 * Creates or updates an other-cost plan line of an element.
 * @mcp upsert
 */
export async function upsertProjectElementCost(
  client: Client,
  line:
    | (CostFields & {
        projectId: string;
        companyId: string;
        createdBy: string;
      })
    | (CostFields & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
) {
  const fields = { description: line.description, amount: line.amount };
  if ("createdBy" in line) {
    return client
      .from("projectElementCost")
      .insert([
        {
          ...fields,
          projectId: line.projectId,
          projectElementId: line.projectElementId,
          companyId: line.companyId,
          createdBy: line.createdBy
        }
      ])
      .select("id")
      .single();
  }
  return client
    .from("projectElementCost")
    .update({
      ...fields,
      updatedBy: line.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", line.id)
    .eq("companyId", line.companyId)
    .select("id")
    .single();
}

/**
 * Deletes an other-cost plan line.
 * @mcp delete
 */
export async function deleteProjectElementCost(
  client: Client,
  id: string,
  companyId: string
) {
  return client
    .from("projectElementCost")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

// --- Labor categories --------------------------------------------------------

/**
 * Lists the labor categories of the company.
 * @mcp read
 */
export async function getLaborCategories(
  client: Client,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("laborCategory")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

/**
 * Gets one labor category.
 * @mcp read
 */
export async function getLaborCategory(
  client: Client,
  id: string,
  companyId: string
) {
  return client
    .from("laborCategory")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

/**
 * Lists the active labor categories of the company, for a picker.
 * @mcp read
 */
export async function getLaborCategoriesList(
  client: Client,
  companyId: string
) {
  return client
    .from("laborCategory")
    .select("id, name")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name", { ascending: true });
}

type LaborCategoryFields = Omit<z.infer<typeof laborCategoryValidator>, "id">;

/**
 * Creates or updates a labor category.
 * @mcp upsert
 */
export async function upsertLaborCategory(
  client: Client,
  category:
    | (LaborCategoryFields & { companyId: string; createdBy: string })
    | (LaborCategoryFields & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
) {
  const fields = {
    name: category.name,
    description: category.description ?? null,
    active: category.active ?? true
  };
  if ("createdBy" in category) {
    return client
      .from("laborCategory")
      .insert([
        {
          ...fields,
          companyId: category.companyId,
          createdBy: category.createdBy
        }
      ])
      .select("id")
      .single();
  }
  return client
    .from("laborCategory")
    .update({
      ...fields,
      updatedBy: category.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", category.id)
    .eq("companyId", category.companyId)
    .select("id")
    .single();
}

/**
 * Lists the cost rates of a labor category, newest first.
 * @mcp read
 */
export async function getLaborCategoryRates(
  client: Client,
  laborCategoryId: string,
  companyId: string
) {
  return client
    .from("laborCategoryRate")
    .select("*")
    .eq("laborCategoryId", laborCategoryId)
    .eq("companyId", companyId)
    .order("effectiveFrom", { ascending: false });
}

type LaborCategoryRateFields = Omit<
  z.infer<typeof laborCategoryRateValidator>,
  "id"
>;

/**
 * Creates or updates an effective-dated cost rate of a labor category.
 * @mcp upsert
 */
export async function upsertLaborCategoryRate(
  client: Client,
  rate:
    | (LaborCategoryRateFields & { companyId: string; createdBy: string })
    | (LaborCategoryRateFields & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in rate) {
    return client
      .from("laborCategoryRate")
      .insert([
        {
          laborCategoryId: rate.laborCategoryId,
          effectiveFrom: rate.effectiveFrom,
          costRate: rate.costRate,
          companyId: rate.companyId,
          createdBy: rate.createdBy
        }
      ])
      .select("id")
      .single();
  }
  return client
    .from("laborCategoryRate")
    .update({
      effectiveFrom: rate.effectiveFrom,
      costRate: rate.costRate,
      updatedBy: rate.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", rate.id)
    .eq("companyId", rate.companyId)
    .select("id")
    .single();
}

// --- Timesheets --------------------------------------------------------------

const TIMESHEET_ENTRY_COLUMNS =
  "id, employeeId, entryDate, projectId, projectElementId, laborCategoryId, hours, note, status, submittedAt, approvedAt, rejectionNote, costRate, reversalOfId, correctionReason, postedAt, project:project!timesheetEntry_project_fkey(id, identifier, name, projectType, serviceOrder!serviceOrder_project_fkey(id, serviceOrderId)), element:projectElement!timesheetEntry_element_fkey(id, readableId, name), laborCategory:laborCategory!timesheetEntry_category_fkey(id, name)" as const;

/**
 * Gets an employee's timesheet entries between two dates (inclusive), with
 * the project, element and labor category names. A Service project carries
 * its service order.
 * @mcp read
 */
export async function getTimesheetWeek(
  client: Client,
  args: { companyId: string; employeeId: string; from: string; to: string }
) {
  return client
    .from("timesheetEntry")
    .select(TIMESHEET_ENTRY_COLUMNS)
    .eq("companyId", args.companyId)
    .eq("employeeId", args.employeeId)
    .gte("entryDate", args.from)
    .lte("entryDate", args.to)
    .order("entryDate", { ascending: true })
    .order("createdAt", { ascending: true });
}

/**
 * Saves one cell of the timesheet grid. A Draft entry is updated, or deleted
 * when the hours are 0. A Rejected entry goes back to Draft with the new
 * hours. A Submitted, Approved or Posted entry is refused: a posted entry
 * changes only through a correction.
 * @mcp action destructive
 */
export async function upsertTimesheetCell(
  client: Client,
  args: Omit<z.infer<typeof timesheetCellValidator>, "projectElementId"> & {
    projectElementId?: string | null;
    companyId: string;
    employeeId: string;
    userId: string;
  }
) {
  let existing = client
    .from("timesheetEntry")
    .select("id, status")
    .eq("companyId", args.companyId)
    .eq("employeeId", args.employeeId)
    .eq("entryDate", args.entryDate)
    .eq("projectId", args.projectId)
    .eq("laborCategoryId", args.laborCategoryId)
    .is("reversalOfId", null);
  existing = args.projectElementId
    ? existing.eq("projectElementId", args.projectElementId)
    : existing.is("projectElementId", null);
  const entries = await existing;
  if (entries.error) return { data: null, error: entries.error };

  const rows = entries.data ?? [];
  const editable =
    rows.find((row) => row.status === "Draft") ??
    rows.find((row) => row.status === "Rejected");

  if (!editable) {
    if (rows.some((row) => row.status === "Posted")) {
      return refusal(
        "This time is posted. Use a correction to change posted hours."
      );
    }
    if (rows.length > 0) {
      return refusal(
        "This time is submitted. It can change only after it is rejected."
      );
    }
    if (args.hours === 0) return { data: null, error: null };
    return client
      .from("timesheetEntry")
      .insert([
        {
          companyId: args.companyId,
          employeeId: args.employeeId,
          entryDate: args.entryDate,
          projectId: args.projectId,
          projectElementId: args.projectElementId ?? null,
          laborCategoryId: args.laborCategoryId,
          hours: args.hours,
          note: args.note ?? null,
          status: "Draft",
          createdBy: args.userId
        }
      ])
      .select("id")
      .single();
  }

  if (args.hours === 0) {
    return client
      .from("timesheetEntry")
      .delete()
      .eq("id", editable.id)
      .eq("companyId", args.companyId)
      .in("status", ["Draft", "Rejected"])
      .select("id")
      .single();
  }

  return client
    .from("timesheetEntry")
    .update({
      hours: args.hours,
      note: args.note ?? null,
      status: "Draft",
      rejectionNote: null,
      updatedBy: args.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", editable.id)
    .eq("companyId", args.companyId)
    .in("status", ["Draft", "Rejected"])
    .select("id")
    .single();
}

/**
 * Submits an employee's Draft entries of Standard projects between two
 * dates (inclusive). Returns the ids it submitted.
 * @mcp action
 */
export async function submitTimesheetEntries(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    employeeId: string;
    from: string;
    to: string;
    userId: string;
  }
) {
  const now = datetime.timestamp();
  const rows = await db
    .updateTable("timesheetEntry")
    .set({
      status: "Submitted",
      submittedAt: now,
      updatedBy: args.userId,
      updatedAt: now
    })
    .where("companyId", "=", args.companyId)
    .where("employeeId", "=", args.employeeId)
    .where("status", "=", "Draft")
    .where("entryDate", ">=", args.from)
    .where("entryDate", "<=", args.to)
    // A service order's time is posted from its visit page, never here.
    .where("projectId", "in", (eb) =>
      eb
        .selectFrom("project")
        .select("id")
        .where("companyId", "=", args.companyId)
        .where("projectType", "=", "Standard")
    )
    .returning("id")
    .execute();
  return rows.map((row) => row.id);
}

/**
 * Approves Submitted entries. Returns the ids it approved; the caller posts
 * them.
 * @mcp action
 */
export async function approveTimesheetEntries(
  client: Client,
  args: { ids: string[]; companyId: string; approvedBy: string }
) {
  const now = datetime.timestamp();
  return client
    .from("timesheetEntry")
    .update({
      status: "Approved",
      approvedBy: args.approvedBy,
      approvedAt: now,
      updatedBy: args.approvedBy,
      updatedAt: now
    })
    .in("id", args.ids)
    .eq("companyId", args.companyId)
    .eq("status", "Submitted")
    .select("id");
}

/**
 * Rejects Submitted entries with a note. The employee can edit them again.
 * @mcp action
 */
export async function rejectTimesheetEntries(
  client: Client,
  args: { ids: string[]; companyId: string; note: string; updatedBy: string }
) {
  return client
    .from("timesheetEntry")
    .update({
      status: "Rejected",
      rejectionNote: args.note,
      updatedBy: args.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .in("id", args.ids)
    .eq("companyId", args.companyId)
    .eq("status", "Submitted")
    .select("id");
}

/**
 * Corrects a Posted entry: a Submitted reversal of the original hours and,
 * when `hours` is not 0, a Submitted replacement. Both carry the reason.
 * Returns the reversal id and the replacement id (or null).
 * @mcp action
 */
export async function createTimesheetCorrection(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    timesheetEntryId: string;
    hours: number;
    correctionReason: string;
  }
) {
  return db.transaction().execute(async (trx) => {
    const original = await trx
      .selectFrom("timesheetEntry")
      .selectAll()
      .where("id", "=", args.timesheetEntryId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!original) throw new Error("The timesheet entry does not exist");
    if (original.status !== "Posted") {
      throw new Error("Only a posted entry needs a correction");
    }
    if (original.reversalOfId) {
      throw new Error("A reversal cannot be corrected");
    }

    const reversed = await trx
      .selectFrom("timesheetEntry")
      .select("id")
      .where("reversalOfId", "=", original.id)
      .where("companyId", "=", args.companyId)
      .executeTakeFirst();
    if (reversed) throw new Error("This entry is already corrected");

    const now = datetime.timestamp();
    const shared = {
      companyId: args.companyId,
      employeeId: original.employeeId,
      entryDate: original.entryDate,
      projectId: original.projectId,
      projectElementId: original.projectElementId,
      laborCategoryId: original.laborCategoryId,
      note: original.note,
      correctionReason: args.correctionReason,
      // A service entry's coverage override travels to the replacement.
      // post-timesheet posts the reversal at its original's coverage.
      coverage: original.coverageReason ? original.coverage : null,
      coverageReason: original.coverageReason,
      status: "Submitted" as const,
      submittedAt: now,
      createdBy: args.userId
    };

    const reversal = await trx
      .insertInto("timesheetEntry")
      .values({
        ...shared,
        hours: -Number(original.hours),
        reversalOfId: original.id
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    let replacementId: string | null = null;
    if (args.hours !== 0) {
      const replacement = await trx
        .insertInto("timesheetEntry")
        .values({ ...shared, hours: args.hours, reversalOfId: null })
        .returning("id")
        .executeTakeFirstOrThrow();
      replacementId = replacement.id;
    }

    return { reversalId: reversal.id, replacementId };
  });
}

/**
 * Lists Submitted entries, grouped by employee and week (Monday). When
 * `ownerId` is set, only entries on projects that user owns are listed;
 * pass null for a user with `projects_update`.
 * @mcp read
 */
export async function getTimesheetApprovals(
  client: Client,
  companyId: string,
  args: { ownerId: string | null }
) {
  const entries = await fetchAll<TimesheetApprovalEntry>(() => {
    let query = client
      .from("timesheetEntry")
      .select(TIMESHEET_APPROVAL_COLUMNS)
      .eq("companyId", companyId)
      .eq("status", "Submitted")
      .order("employeeId", { ascending: true })
      .order("entryDate", { ascending: true })
      .order("id", { ascending: true });
    if (args.ownerId) {
      query = query.eq("project.ownerId", args.ownerId);
    }
    return query;
  });
  if (entries.error) {
    return { data: null, error: entries.error as unknown as PostgrestError };
  }

  const groups = new Map<
    string,
    {
      key: string;
      employeeId: string;
      employee: TimesheetApprovalEntry["employee"];
      weekStart: string;
      entries: TimesheetApprovalEntry[];
      totalHours: number;
    }
  >();
  for (const entry of entries.data ?? []) {
    const weekStart = weekStartOf(entry.entryDate);
    const key = `${entry.employeeId}:${weekStart}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        employeeId: entry.employeeId,
        employee: entry.employee,
        weekStart,
        entries: [],
        totalHours: 0
      };
      groups.set(key, group);
    }
    group.entries.push(entry);
    group.totalHours += Number(entry.hours);
  }

  return { data: [...groups.values()], error: null };
}

const TIMESHEET_APPROVAL_COLUMNS =
  "id, employeeId, entryDate, projectId, projectElementId, laborCategoryId, hours, note, status, submittedAt, reversalOfId, correctionReason, employee:user!timesheetEntry_employeeId_fkey(id, fullName, avatarUrl), project:project!timesheetEntry_project_fkey!inner(id, identifier, name, ownerId), element:projectElement!timesheetEntry_element_fkey(id, readableId, name), laborCategory:laborCategory!timesheetEntry_category_fkey(id, name)" as const;

function timesheetApprovalsQuery(client: Client) {
  return client.from("timesheetEntry").select(TIMESHEET_APPROVAL_COLUMNS);
}

type TimesheetApprovalEntry = NonNullable<
  Awaited<ReturnType<typeof timesheetApprovalsQuery>>["data"]
>[number];

// --- Project ledger and costs ------------------------------------------------

/**
 * Lists project ledger rows. Filters are the project, element ids and cost
 * type.
 * @mcp read
 */
export async function getProjectLedger(
  client: Client,
  companyId: string,
  args: GenericQueryFilters & {
    projectId: string;
    projectElementIds?: string[] | null;
    costType?: ProjectCostType | null;
  }
) {
  let query = client
    .from("projectLedger")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId)
    .eq("projectId", args.projectId);

  if (args.projectElementIds && args.projectElementIds.length > 0) {
    query = query.in("projectElementId", args.projectElementIds);
  }
  if (args.costType) {
    query = query.eq("costType", args.costType);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "postingDate", ascending: false }
  ]);
  return query;
}

const PROJECT_ELEMENT_COST_COLUMNS =
  "id, parentId, sortOrder, readableId, name, type, budget, estimateAtCompletion" as const;

function projectElementCostsQuery(
  client: Client,
  projectId: string,
  companyId: string
) {
  return client
    .from("projectElement")
    .select(PROJECT_ELEMENT_COST_COLUMNS)
    .eq("projectId", projectId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("id", { ascending: true });
}

export type ProjectElementCostItem = NonNullable<
  Awaited<ReturnType<typeof projectElementCostsQuery>>["data"]
>[number];

/**
 * Lists every element of a project with its budget and estimate at
 * completion, for the Costs tab. Pages through the rows.
 * @mcp read
 */
export async function getProjectElementCosts(
  client: Client,
  projectId: string,
  companyId: string
) {
  return fetchAll<ProjectElementCostItem>(() =>
    projectElementCostsQuery(client, projectId, companyId)
  );
}

/**
 * Lists the timesheet entries of a project that are not Posted yet, newest
 * first (at most 500).
 * @mcp read
 */
export async function getProjectOpenTimesheetEntries(
  client: Client,
  projectId: string,
  companyId: string
) {
  return client
    .from("timesheetEntry")
    .select(TIMESHEET_ENTRY_COLUMNS)
    .eq("companyId", companyId)
    .eq("projectId", projectId)
    .neq("status", "Posted")
    .order("entryDate", { ascending: false })
    .order("createdAt", { ascending: false })
    .limit(500);
}

/**
 * Gets plan, committed, actual and hours per element of a project, plus one
 * row with no element for charges to the project itself.
 * @mcp read
 */
export async function getProjectCostSummary(
  client: Client,
  projectId: string,
  companyId: string
) {
  return client.rpc("get_project_cost_summary", {
    p_project_id: projectId,
    p_company_id: companyId
  });
}

// --- Views and preferences ---------------------------------------------------

/**
 * The saved views of a project the user can see: their own views, then the
 * views other people shared. RLS hides another user's private view.
 */
export async function getProjectViews(
  client: Client,
  args: { projectId: string; companyId: string; userId: string }
) {
  return client
    .from("projectView")
    .select("id, name, isShared, layout, filters, displayOptions, createdBy")
    .eq("projectId", args.projectId)
    .eq("companyId", args.companyId)
    .or(`createdBy.eq.${args.userId},isShared.eq.true`)
    .order("sortOrder", { ascending: true })
    .order("name", { ascending: true });
}

type ProjectDisplayStateRow = {
  layout: ProjectLayout;
  filters: ProjectElementFilterState;
  displayOptions: ProjectDisplayOptions;
};

/** Creates a view, or updates the user's own view when `id` is set. */
export async function upsertProjectView(
  client: Client,
  view: ProjectDisplayStateRow & {
    id?: string;
    name: string;
    isShared: boolean;
    projectId: string;
    companyId: string;
    userId: string;
  }
) {
  const fields = {
    name: view.name,
    isShared: view.isShared,
    layout: view.layout,
    filters: view.filters as unknown as Json,
    displayOptions: view.displayOptions as unknown as Json
  };
  if (view.id) {
    return client
      .from("projectView")
      .update({
        ...fields,
        updatedBy: view.userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", view.id)
      .eq("projectId", view.projectId)
      .eq("companyId", view.companyId)
      .eq("createdBy", view.userId)
      .select("id")
      .single();
  }
  return client
    .from("projectView")
    .insert([
      {
        ...fields,
        projectId: view.projectId,
        companyId: view.companyId,
        createdBy: view.userId
      }
    ])
    .select("id")
    .single();
}

/** Deletes one of the user's own views. */
export async function deleteProjectView(
  client: Client,
  args: { id: string; projectId: string; companyId: string; userId: string }
) {
  return client
    .from("projectView")
    .delete()
    .eq("id", args.id)
    .eq("projectId", args.projectId)
    .eq("companyId", args.companyId)
    .eq("createdBy", args.userId);
}

/** The user's last layout, filters and display options on a project. */
export async function getProjectUserPreference(
  client: Client,
  args: { projectId: string; companyId: string; userId: string }
) {
  return client
    .from("projectUserPreference")
    .select("layout, filters, displayOptions")
    .eq("projectId", args.projectId)
    .eq("companyId", args.companyId)
    .eq("userId", args.userId)
    .maybeSingle();
}

/** Keeps the user's layout, filters and display options on a project. */
export async function upsertProjectUserPreference(
  client: Client,
  preference: ProjectDisplayStateRow & {
    projectId: string;
    companyId: string;
    userId: string;
  }
) {
  return client.from("projectUserPreference").upsert(
    {
      projectId: preference.projectId,
      companyId: preference.companyId,
      userId: preference.userId,
      layout: preference.layout,
      filters: preference.filters as unknown as Json,
      displayOptions: preference.displayOptions as unknown as Json,
      updatedAt: datetime.timestamp()
    },
    { onConflict: "projectId,userId,companyId" }
  );
}
