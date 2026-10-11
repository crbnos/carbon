// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database, Json } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { fetchAll } from "@carbon/database/fetch-all";
import { toJson } from "@carbon/database/json";
import { BILLABLE_REASON_NO_BILL_RATE, datetime, round } from "@carbon/utils";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { LIST_COUNT, setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { updateSortOrder } from "../shared/sort-order";
import type {
  BillableItemAction,
  ItemValues,
  LaborDistributionLaborRow,
  laborCategoryRateValidator,
  laborCategoryValidator,
  ProjectBorrowStatus,
  ProjectCostTreatment,
  ProjectCostType,
  ProjectDisplayOptions,
  ProjectElementEditableField,
  ProjectElementFilterState,
  ProjectElementType,
  ProjectLayout,
  ProjectStateGroup,
  ProjectStatus,
  ProjectStockTransferAction,
  ProjectStockTransferType,
  projectElementCostValidator,
  projectElementLaborValidator,
  projectElementLinkValidator,
  projectElementMaterialValidator,
  projectLabelValidator,
  projectMilestoneValidator,
  projectStateValidator,
  projectStockTransferLineValidator,
  projectValidator
} from "./projects.models";
import {
  apportionedBaseRefusal,
  canLink,
  elementDeleteRefusal,
  governmentFurnishedRefusal,
  PARAMETER_ITEM_UNIT_COST,
  parameterSources,
  projectStockTransferActionFrom,
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
  /** The project keeps its own stock: a job can receive into it. */
  projectStock: boolean;
  /**
   * Capitalize only: the asset under construction a job of this charge
   * number builds (the element's own asset when it is a final asset, else
   * its nearest final-asset ancestor's, else the project's). Null otherwise.
   */
  targetFixedAssetId: string | null;
  /** `FA000012 — name` of the target asset, for display. */
  targetFixedAssetLabel: string | null;
  /** A leave element (5a): DCAA mode takes time for a future date on it. */
  isLeave: boolean;
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
      projectStock: boolean;
    }>(() =>
      client
        .from("project")
        .select(
          "id, identifier, name, costTreatment, fixedAssetId, projectStock"
        )
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
      isLeave: boolean;
      project: {
        name: string;
        costTreatment: ProjectCostTreatment;
        projectStock: boolean;
      } | null;
    }>(() =>
      client
        .from("projectElement")
        .select(
          "id, projectId, readableId, name, isLeave, project:project!projectElement_project_fkey!inner(name, costTreatment, projectStock), state:projectState!projectElement_state_fkey!inner(group)"
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
        projectStock: project.projectStock,
        targetFixedAssetId: targetFixedAssetId(project.id, null),
        targetFixedAssetLabel: null,
        isLeave: false
      }));

  const elementRows: ChargeNumber[] = (elements.data ?? []).map((element) => ({
    value: `${element.projectId}|${element.id}`,
    projectId: element.projectId,
    projectElementId: element.id,
    readableId: element.readableId,
    name: element.name,
    projectName: element.project?.name ?? "",
    costTreatment: element.project?.costTreatment ?? "Statistical",
    projectStock: element.project?.projectStock ?? false,
    targetFixedAssetId: targetFixedAssetId(element.projectId, element.id),
    targetFixedAssetLabel: null,
    isLeave: element.isLeave
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
  "id, projectId, readableId, sequence, type, parentId, name, stateId, ownerId, priority, milestoneId, startDate, targetDate, completedAt, estimatedHours, isChargeable, isUnallowable, budget, itemId, sortOrder, createdAt, updatedAt, requirementCategory, targetOperator, targetValue, targetUpperValue, targetUnit, verificationMethod, actualParameterId, qualityDocumentId, verdict, verdictAt, verdictBy, parameterValue, parameterUnit, parameterSource, parameterFormula, parameterItemField, parameterContingencyPercent, allocationPercent, state:projectState!projectElement_state_fkey!inner(name, group, color), labels:projectElementLabel!projectElementLabel_element_fkey(projectLabelId)" as const;

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
 * The comment count of each element of a project that has comments. One
 * paged read: each element row embeds the count of its comments.
 */
export async function getProjectElementCommentCounts(
  client: Client,
  projectId: string,
  companyId: string
) {
  const rows = await fetchAll<{ id: string; comments: { count: number }[] }>(
    () =>
      client
        .from("projectElement")
        .select(
          "id, comments:projectElementComment!projectElementComment_element_fkey(count)"
        )
        .eq("projectId", projectId)
        .eq("companyId", companyId)
        .order("id", { ascending: true })
  );
  if (rows.error) return { data: null, error: rows.error };
  return {
    data: (rows.data ?? [])
      .map((row) => ({ id: row.id, count: row.comments[0]?.count ?? 0 }))
      .filter((row) => row.count > 0),
    error: null
  };
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
    case "isUnallowable":
    case "isPreproduction":
      update[args.field] = raw === "true" || raw === "on";
      break;
    case "isLeave": {
      // Leave is an indirect cost: only an Indirect project has leave elements.
      const value = raw === "true" || raw === "on";
      if (value) {
        const elements = await client
          .from("projectElement")
          .select(
            "readableId, project:project!projectElement_project_fkey!inner(costObjective)"
          )
          .in("id", args.ids)
          .eq("companyId", args.companyId);
        if (elements.error) return { data: null, error: elements.error };
        const direct = elements.data.find(
          (element) => element.project?.costObjective !== "Indirect"
        );
        if (direct) {
          return refusal(
            `${direct.readableId} is not on an Indirect project. Only an Indirect project has leave elements.`
          );
        }
      }
      update.isLeave = value;
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
 * descendant has a project ledger row, a timesheet entry, a job, a
 * purchase order line or an earned value snapshot, or is the base of an
 * Apportioned element outside the subtree.
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

  const all = await fetchAll<{
    id: string;
    parentId: string | null;
    readableId: string;
    name: string;
    earnedValueTechnique: string | null;
    apportionedToElementId: string | null;
  }>(() =>
    client
      .from("projectElement")
      .select(
        "id, parentId, readableId, name, earnedValueTechnique, apportionedToElementId"
      )
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

  const apportioned = apportionedBaseRefusal(subtree, all.data ?? []);
  if (apportioned) return refusal(apportioned);

  const [
    ledger,
    timesheets,
    jobs,
    purchaseLines,
    earnedValueRows,
    earnedValueAccounts
  ] = await Promise.all([
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
      .eq("companyId", companyId),
    // An earned value snapshot names its work package and its control
    // account. Both FKs have no ON DELETE action.
    client
      .from("earnedValuePeriod")
      .select("id", { count: "exact", head: true })
      .in("projectElementId", subtree)
      .eq("companyId", companyId),
    client
      .from("earnedValuePeriod")
      .select("id", { count: "exact", head: true })
      .in("controlAccountId", subtree)
      .eq("companyId", companyId)
  ]);
  for (const result of [
    ledger,
    timesheets,
    jobs,
    purchaseLines,
    earnedValueRows,
    earnedValueAccounts
  ]) {
    if (result.error) return { data: null, error: result.error };
  }
  const charged = elementDeleteRefusal({
    ledger: ledger.count ?? 0,
    timesheets: timesheets.count ?? 0,
    jobs: jobs.count ?? 0,
    purchaseLines: purchaseLines.count ?? 0,
    earnedValue: (earnedValueRows.count ?? 0) + (earnedValueAccounts.count ?? 0)
  });
  if (charged) return refusal(charged);

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
    .select(
      "*, rates:laborCategoryRate!laborCategoryRate_category_fkey(costRate, billRate, effectiveFrom)",
      { count: LIST_COUNT }
    )
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
 * Creates or updates an effective-dated cost rate of a labor category, with
 * its default bill rate (the price of an hour on a Time & Materials contract
 * line with no contract rate).
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
          billRate: rate.billRate ?? null,
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
      billRate: rate.billRate ?? null,
      updatedBy: rate.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", rate.id)
    .eq("companyId", rate.companyId)
    .select("id")
    .single();
}

// --- Contract billing (Projects Phase 4a) ---------------------------------------

type ProjectBillableItemStatus =
  Database["public"]["Enums"]["projectBillableItemStatus"];

/**
 * Lists the billing elements of one project (`isBilling`), for a contract
 * line's billing element. Only a Contract-treatment project has them.
 * @mcp read
 */
export async function getProjectBillingElements(
  client: Client,
  projectId: string,
  companyId: string
) {
  return client
    .from("projectElement")
    .select(
      "id, readableId, name, type, project:project!projectElement_project_fkey!inner(costTreatment)"
    )
    .eq("projectId", projectId)
    .eq("companyId", companyId)
    .eq("isBilling", true)
    .eq("project.costTreatment", "Contract")
    .order("sortOrder", { ascending: true })
    .order("id", { ascending: true });
}

const CONTRACT_BILLABLE_ITEM_COLUMNS =
  "id, projectId, projectElementId, projectLedgerId, customerContractLineId, itemId, description, quantity, unitPrice, amount, status, statusReason, reversalOfId, salesInvoiceLineId, voidedSalesInvoiceId, createdAt, ledger:projectLedger!projectBillableItem_ledger_fkey(postingDate, costType, documentType, documentId, employeeId, laborCategoryId, quantity, amount), element:projectElement!projectBillableItem_element_fkey(id, readableId, name), project:project!projectBillableItem_project_fkey(id, identifier, name), contractLine:customerContractLine!projectBillableItem_contractLine_fkey(id, customerContractId, billingMethod, description), invoiceLine:salesInvoiceLine!projectBillableItem_invoiceLine_fkey(invoiceId)" as const;

function contractBillableItemsQuery(client: Client, companyId: string) {
  return client
    .from("projectBillableItem")
    .select(CONTRACT_BILLABLE_ITEM_COLUMNS, { count: LIST_COUNT })
    .eq("companyId", companyId)
    .not("customerContractLineId", "is", null);
}

/** One contract billable item as `getContractBillableItems` returns it.
 *  Typed from the base query: `setGenericQueryFilters` loses the row type. */
export type ContractBillableItemRow = NonNullable<
  Awaited<ReturnType<typeof contractBillableItemsQuery>>["data"]
>[number];

/**
 * Lists the billable items of contract billing lines, with the ledger row's
 * posting date and cost type, and the invoice that billed each one. Filter
 * by contract line, project or status.
 * @mcp read
 */
export async function getContractBillableItems(
  client: Client,
  args: Partial<GenericQueryFilters> & {
    companyId: string;
    customerContractLineId?: string | null;
    projectId?: string | null;
    status?: ProjectBillableItemStatus[] | null;
  }
): Promise<{
  data: ContractBillableItemRow[] | null;
  count: number | null;
  error: PostgrestError | null;
}> {
  let query = contractBillableItemsQuery(client, args.companyId);

  if (args.customerContractLineId) {
    query = query.eq("customerContractLineId", args.customerContractLineId);
  }
  if (args.projectId) {
    query = query.eq("projectId", args.projectId);
  }
  if (args.status && args.status.length > 0) {
    query = query.in("status", args.status);
  }

  const result = await setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: true }
  ]);
  return {
    data: (result.data ?? null) as ContractBillableItemRow[] | null,
    count: result.count ?? null,
    error: result.error
  };
}

/**
 * Lists the Time & Materials and Cost Plus contract lines, of one project or
 * of the company, with their contract, billing element and funding terms.
 * @mcp read
 */
export async function getContractBillingLines(
  client: Client,
  args: { companyId: string; projectId?: string | null }
) {
  let query = client
    .from("customerContractLine")
    .select(
      "id, customerContractId, projectId, projectElementId, billingMethod, revenueMethod, description, fundedAmount, fundedCost, ceilingAmount, noticePercent, startDate, endDate, item(name), contract:customerContract!customerContractLine_contract_fkey(id, customerContractId, status), element:projectElement!customerContractLine_projectElement_fkey(readableId, name)"
    )
    .eq("companyId", args.companyId)
    .neq("billingMethod", "Fixed");
  if (args.projectId) query = query.eq("projectId", args.projectId);
  return query
    .order("customerContractId", { ascending: true })
    .order("startDate", { ascending: true });
}

export type ProjectContractRevenue = {
  /** Σ the line's months recognized in Carbon or externally. */
  recognizedToDate: number;
  /** The latest month's progress (0–1); null for Right to Invoice. */
  percentComplete: number | null;
  estimateAtCompletion: number | null;
  transactionPrice: number | null;
};

/**
 * The revenue of project contract lines, per line: what the revenue
 * recognition runs recognized to date, and the progress figures of the
 * latest month (Phase 4b).
 */
export async function getProjectContractRevenue(
  client: Client,
  args: { companyId: string; lineIds: string[] }
): Promise<{
  data: Record<string, ProjectContractRevenue> | null;
  error: PostgrestError | null;
}> {
  if (args.lineIds.length === 0) return { data: {}, error: null };
  const months = await client
    .from("customerContractRevenue")
    .select(
      "customerContractLineId, periodStart, amount, status, progress, estimateAtCompletion, transactionPrice"
    )
    .eq("companyId", args.companyId)
    .in("customerContractLineId", args.lineIds)
    .order("periodStart", { ascending: true });
  if (months.error) return { data: null, error: months.error };

  const byLine: Record<string, ProjectContractRevenue> = {};
  for (const month of months.data ?? []) {
    const line = byLine[month.customerContractLineId] ?? {
      recognizedToDate: 0,
      percentComplete: null,
      estimateAtCompletion: null,
      transactionPrice: null
    };
    if (month.status !== "Planned") {
      line.recognizedToDate += Number(month.amount);
    }
    // Ordered by month, so the last month seen is the latest.
    line.percentComplete =
      month.progress === null ? null : Number(month.progress);
    line.estimateAtCompletion =
      month.estimateAtCompletion === null
        ? null
        : Number(month.estimateAtCompletion);
    line.transactionPrice =
      month.transactionPrice === null ? null : Number(month.transactionPrice);
    byLine[month.customerContractLineId] = line;
  }
  return { data: byLine, error: null };
}

/** The statuses each review action applies to. Billed and Written Off
 *  items never change. */
const BILLABLE_ITEM_ACTION_FROM: Record<
  BillableItemAction,
  readonly ProjectBillableItemStatus[]
> = {
  hold: ["Unbilled", "On Hold"],
  release: ["On Hold"],
  writeOff: ["Unbilled", "On Hold"],
  price: ["Unbilled", "On Hold"]
};

/**
 * Reviews contract billable items before they are billed: hold them with a
 * reason, release a hold, write them off with a reason, or change one item's
 * unit price (the amount follows; a "No bill rate" hold is released). Billed
 * and Written Off items are refused. Each change reaches the audit log
 * ("Billable Item").
 * @mcp update
 */
export async function updateProjectBillableItems(
  client: Client,
  args: {
    companyId: string;
    userId: string;
    ids: string[];
    action: BillableItemAction;
    reason?: string;
    unitPrice?: number;
  }
) {
  const ids = [...new Set(args.ids)];
  if (ids.length === 0) return refusal("Choose at least one item");

  const current = await client
    .from("projectBillableItem")
    .select("id, quantity, status, statusReason, reversalOfId")
    .eq("companyId", args.companyId)
    .not("customerContractLineId", "is", null)
    .in("id", ids);
  if (current.error) return { data: null, error: current.error };
  if (current.data.length !== ids.length) {
    return refusal("Some items were not found");
  }

  const from = BILLABLE_ITEM_ACTION_FROM[args.action];
  if (current.data.some((item) => !from.includes(item.status))) {
    return refusal(
      args.action === "release"
        ? "Only an item on hold can be released"
        : "A billed or written off item cannot change"
    );
  }

  const stamp = {
    updatedBy: args.userId,
    updatedAt: datetime.timestamp()
  };

  if (args.action === "price") {
    if (ids.length !== 1)
      return refusal("Edit the price of one item at a time");
    if (args.unitPrice === undefined || args.unitPrice < 0) {
      return refusal("A unit price is required");
    }
    const [item] = current.data;
    if (item.reversalOfId) return refusal("A reversal cannot change");
    const releasesHold =
      item.status === "On Hold" &&
      item.statusReason === BILLABLE_REASON_NO_BILL_RATE;
    return client
      .from("projectBillableItem")
      .update({
        unitPrice: args.unitPrice,
        amount: round(Number(item.quantity) * args.unitPrice),
        ...(releasesHold
          ? { status: "Unbilled" as const, statusReason: null }
          : {}),
        ...stamp
      })
      .eq("id", item.id)
      .eq("companyId", args.companyId)
      .in("status", [...from])
      .select("id");
  }

  const reason = args.reason?.trim() || null;
  if ((args.action === "hold" || args.action === "writeOff") && !reason) {
    return refusal("A reason is required");
  }

  const values =
    args.action === "hold"
      ? { status: "On Hold" as const, statusReason: reason }
      : args.action === "writeOff"
        ? { status: "Written Off" as const, statusReason: reason }
        : { status: "Unbilled" as const, statusReason: null };

  return client
    .from("projectBillableItem")
    .update({ ...values, ...stamp })
    .eq("companyId", args.companyId)
    .in("id", ids)
    .in("status", [...from])
    .select("id");
}

// --- Planning groups (Projects Phase 3) ---------------------------------------
// Authoring a group is commercial: `upsertPlanningGroup` lives in
// `@carbon/ee/pegging.server`, with the entitlement check inside it.

const PLANNING_GROUP_COLUMNS =
  "*, location:location!planningGroup_locationId_fkey(id, name), exceptionProject:project!planningGroup_exception_fkey(id, identifier, name), members:project!project_planningGroup_fkey(count)" as const;

/**
 * Lists the planning groups of the company, with their location, the
 * exception project and the count of member projects.
 * @mcp read
 */
export async function getPlanningGroups(
  client: Client,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("planningGroup")
    .select(PLANNING_GROUP_COLUMNS, { count: LIST_COUNT })
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
 * Gets one planning group.
 * @mcp read
 */
export async function getPlanningGroup(
  client: Client,
  planningGroupId: string,
  companyId: string
) {
  return client
    .from("planningGroup")
    .select(PLANNING_GROUP_COLUMNS)
    .eq("id", planningGroupId)
    .eq("companyId", companyId)
    .single();
}

/**
 * Lists the active planning groups of the company, for a picker.
 * @mcp read
 */
export async function getPlanningGroupsList(client: Client, companyId: string) {
  return client
    .from("planningGroup")
    .select("id, name, locationId")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name", { ascending: true });
}

/**
 * Lists the member projects of a planning group. Membership is shown on the
 * group, so no project can hoard the group's stock out of sight.
 * @mcp read
 */
export async function getPlanningGroupMembers(
  client: Client,
  planningGroupId: string,
  companyId: string
) {
  return client
    .from("project")
    .select("id, identifier, name, planningPriority, status")
    .eq("planningGroupId", planningGroupId)
    .eq("companyId", companyId)
    .order("planningPriority", { ascending: true })
    .order("identifier", { ascending: true });
}

/** One peg on the project Pegging tab, with the labels it shows. */
export type ProjectPegRow =
  Database["public"]["Tables"]["projectPeg"]["Row"] & {
    item: { readableIdWithRevision: string | null; name: string } | null;
    /** The supply's readable id: the PO, the job, or null for a planned order. */
    supplyReadableId: string | null;
    /** The supply's document id, for the link (PO id or job id). */
    supplyDocumentId: string | null;
    element: { readableId: string | null; name: string } | null;
  };

/**
 * The pegs of one project (Projects Phase 3). With no `asOf`, the current
 * rows (`supersededAt IS NULL`). With an `asOf` instant, the rows that were
 * current then: created on or before it, and not superseded until after it.
 * The supply has no FK (it is a PO line, a job or a planning action), so its
 * readable id comes from one read per supply type.
 */
export async function getProjectPegs(
  client: Client,
  args: { companyId: string; projectId: string; asOf?: string | null }
): Promise<{ data: ProjectPegRow[]; error: PostgrestError | null }> {
  let query = client
    .from("projectPeg")
    .select("*, item:item!projectPeg_itemId_fkey(readableIdWithRevision, name)")
    .eq("companyId", args.companyId)
    .eq("projectId", args.projectId);
  if (args.asOf) {
    query = query
      .lte("createdAt", args.asOf)
      .or(`supersededAt.is.null,supersededAt.gt."${args.asOf}"`);
  } else {
    query = query.is("supersededAt", null);
  }
  const pegs = await query
    .order("itemId")
    .order("needDate", { ascending: true, nullsFirst: false })
    .order("createdAt");
  if (pegs.error) return { data: [], error: pegs.error };
  const rows = pegs.data ?? [];

  const idsOf = (type: string) => [
    ...new Set(
      rows.filter((row) => row.supplyType === type).map((row) => row.supplyId)
    )
  ];
  const lineIds = idsOf("Purchase Order Line");
  const jobIds = idsOf("Job");
  const elementIds = [
    ...new Set(
      rows
        .map((row) => row.projectElementId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  const [lines, jobs, elements] = await Promise.all([
    lineIds.length > 0
      ? client
          .from("purchaseOrderLine")
          .select(
            "id, purchaseOrderId, purchaseOrder!purchaseOrderLine_purchaseOrderId_fkey(purchaseOrderId)"
          )
          .in("id", lineIds)
          .eq("companyId", args.companyId)
      : Promise.resolve({ data: [], error: null }),
    jobIds.length > 0
      ? client
          .from("job")
          .select("id, jobId")
          .in("id", jobIds)
          .eq("companyId", args.companyId)
      : Promise.resolve({ data: [], error: null }),
    elementIds.length > 0
      ? client
          .from("projectElement")
          .select("id, readableId, name")
          .in("id", elementIds)
          .eq("companyId", args.companyId)
      : Promise.resolve({ data: [], error: null })
  ]);
  const error = lines.error ?? jobs.error ?? elements.error ?? null;
  if (error) return { data: [], error };

  const lineById = new Map(
    (lines.data ?? []).map((line) => [
      line.id,
      {
        documentId: line.purchaseOrderId,
        readableId:
          (line.purchaseOrder as { purchaseOrderId: string } | null)
            ?.purchaseOrderId ?? null
      }
    ])
  );
  const jobById = new Map((jobs.data ?? []).map((job) => [job.id, job.jobId]));
  const elementById = new Map(
    (elements.data ?? []).map((element) => [
      element.id,
      { readableId: element.readableId, name: element.name }
    ])
  );

  return {
    data: rows.map((row) => {
      const line =
        row.supplyType === "Purchase Order Line"
          ? lineById.get(row.supplyId)
          : undefined;
      const jobReadableId =
        row.supplyType === "Job" ? (jobById.get(row.supplyId) ?? null) : null;
      return {
        ...row,
        item: row.item as ProjectPegRow["item"],
        supplyReadableId: line?.readableId ?? jobReadableId,
        supplyDocumentId:
          line?.documentId ?? (row.supplyType === "Job" ? row.supplyId : null),
        element: row.projectElementId
          ? (elementById.get(row.projectElementId) ?? null)
          : null
      };
    }),
    error: null
  };
}

/**
 * The open supply made for a planning group, for some items: the PO lines
 * not yet received in full and the jobs not yet done. A Manual peg names one
 * of them (Projects Phase 3).
 */
export async function getPlanningGroupOpenSupplies(
  client: Client,
  args: { companyId: string; planningGroupId: string; itemIds: string[] }
): Promise<{
  data: {
    supplyType: "Purchase Order Line" | "Job";
    supplyId: string;
    itemId: string;
    readableId: string;
  }[];
  error: PostgrestError | null;
}> {
  if (args.itemIds.length === 0) return { data: [], error: null };
  const [lines, jobs] = await Promise.all([
    client
      .from("purchaseOrderLine")
      .select(
        "id, itemId, purchaseOrder!purchaseOrderLine_purchaseOrderId_fkey(purchaseOrderId)"
      )
      .eq("companyId", args.companyId)
      .eq("planningGroupId", args.planningGroupId)
      .eq("receivedComplete", false)
      .in("itemId", args.itemIds),
    client
      .from("job")
      .select("id, jobId, itemId")
      .eq("companyId", args.companyId)
      .eq("planningGroupId", args.planningGroupId)
      .in("status", ["Planned", "Ready", "In Progress", "Paused"])
      .in("itemId", args.itemIds)
  ]);
  const error = lines.error ?? jobs.error ?? null;
  if (error) return { data: [], error };
  return {
    data: [
      ...(lines.data ?? []).flatMap((line) =>
        line.itemId
          ? [
              {
                supplyType: "Purchase Order Line" as const,
                supplyId: line.id,
                itemId: line.itemId,
                readableId:
                  (line.purchaseOrder as { purchaseOrderId: string } | null)
                    ?.purchaseOrderId ?? line.id
              }
            ]
          : []
      ),
      ...(jobs.data ?? []).flatMap((job) =>
        job.itemId
          ? [
              {
                supplyType: "Job" as const,
                supplyId: job.id,
                itemId: job.itemId,
                readableId: job.jobId
              }
            ]
          : []
      )
    ],
    error: null
  };
}

/**
 * Deletes a planning group. It refuses while a project is a member, or a
 * purchase order line or job is made for the group.
 * @mcp delete
 */
export async function deletePlanningGroup(
  client: Client,
  planningGroupId: string,
  companyId: string
) {
  const [members, lines, jobs] = await Promise.all([
    client
      .from("project")
      .select("id", { count: "exact", head: true })
      .eq("planningGroupId", planningGroupId)
      .eq("companyId", companyId),
    client
      .from("purchaseOrderLine")
      .select("id", { count: "exact", head: true })
      .eq("planningGroupId", planningGroupId)
      .eq("companyId", companyId),
    client
      .from("job")
      .select("id", { count: "exact", head: true })
      .eq("planningGroupId", planningGroupId)
      .eq("companyId", companyId)
  ]);
  const readError = members.error ?? lines.error ?? jobs.error;
  if (readError) return { data: null, error: readError };
  if ((members.count ?? 0) > 0) {
    return refusal("Remove the member projects from the group first");
  }
  if ((lines.count ?? 0) > 0 || (jobs.count ?? 0) > 0) {
    return refusal(
      "The group has purchase order lines or jobs, so it cannot be deleted"
    );
  }

  return client
    .from("planningGroup")
    .delete()
    .eq("id", planningGroupId)
    .eq("companyId", companyId);
}

// --- Timesheets --------------------------------------------------------------

const TIMESHEET_ENTRY_COLUMNS =
  "id, employeeId, entryDate, projectId, projectElementId, laborCategoryId, hours, note, status, submittedAt, approvedAt, rejectionNote, costRate, reversalOfId, correctionReason, postedAt, project:project!timesheetEntry_project_fkey(id, identifier, name, projectType, serviceOrder!serviceOrder_project_fkey(id, serviceOrderId)), element:projectElement!timesheetEntry_element_fkey(id, readableId, name, isLeave), laborCategory:laborCategory!timesheetEntry_category_fkey(id, name)" as const;

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
 * A replacement on another charge number (`projectId`, `projectElementId`)
 * or labor category is a labor transfer. The replacement names its original
 * in `correctionOfId`. In DCAA mode the correction writes one
 * `timesheetEntryRevision` on the original. Returns the reversal id, the
 * replacement id (or null) and `isTransfer`.
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
    projectId?: string;
    projectElementId?: string;
    laborCategoryId?: string;
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
      // A service entry's correction stays on the visit the time was for.
      serviceVisitId: original.serviceVisitId,
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

    // A labor transfer: the replacement takes the new charge number and
    // category. The composite foreign keys keep both in the company, and
    // the element in the project.
    const projectId = args.projectId || original.projectId;
    const projectElementId = args.projectId
      ? args.projectElementId || null
      : original.projectElementId;
    const laborCategoryId = args.laborCategoryId || original.laborCategoryId;
    const isTransfer =
      projectId !== original.projectId ||
      projectElementId !== original.projectElementId;
    const movesProject = projectId !== original.projectId;

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
        .values({
          ...shared,
          projectId,
          projectElementId,
          laborCategoryId,
          // The visit and the coverage override belong to the original
          // project: a transfer to another project drops them.
          ...(movesProject
            ? { serviceVisitId: null, coverage: null, coverageReason: null }
            : {}),
          hours: args.hours,
          reversalOfId: null,
          correctionOfId: original.id
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      replacementId = replacement.id;
    }

    const settings = await trx
      .selectFrom("companySettings")
      .select("timekeepingControls")
      .where("id", "=", args.companyId)
      .executeTakeFirst();
    if (settings?.timekeepingControls === "DCAA") {
      const fields = (entry: {
        hours: number | string;
        projectId: string;
        projectElementId: string | null;
        laborCategoryId: string;
        entryDate: string;
      }) => ({
        hours: Number(entry.hours),
        projectId: entry.projectId,
        projectElementId: entry.projectElementId,
        laborCategoryId: entry.laborCategoryId,
        entryDate: entry.entryDate
      });
      await trx
        .insertInto("timesheetEntryRevision")
        .values({
          companyId: args.companyId,
          timesheetEntryId: original.id,
          employeeId: original.employeeId,
          revisedBy: args.userId,
          reason: args.correctionReason,
          before: toJson(fields(original)) ?? null,
          after:
            args.hours === 0
              ? null
              : (toJson(
                  fields({
                    hours: args.hours,
                    projectId,
                    projectElementId,
                    laborCategoryId,
                    entryDate: original.entryDate
                  })
                ) ?? null)
        })
        .execute();
    }

    return { reversalId: reversal.id, replacementId, isTransfer };
  });
}

// --- Government Contracting 5a: members and the correction trail ---------------

/**
 * Lists the members of a project: the employees who may charge time to it
 * when it restricts charging.
 * @mcp read
 */
export async function getProjectMembers(
  client: Client,
  projectId: string,
  companyId: string
) {
  return client
    .from("projectMember")
    .select(
      "projectId, userId, createdAt, user:user!projectMember_userId_fkey(id, fullName, avatarUrl)"
    )
    .eq("projectId", projectId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true });
}

/**
 * Adds an employee to a project's members.
 * @mcp action
 */
export async function addProjectMember(
  client: Client,
  args: {
    projectId: string;
    userId: string;
    companyId: string;
    createdBy: string;
  }
) {
  return client
    .from("projectMember")
    .upsert(
      [
        {
          projectId: args.projectId,
          userId: args.userId,
          companyId: args.companyId,
          createdBy: args.createdBy
        }
      ],
      { onConflict: "projectId,userId,companyId", ignoreDuplicates: true }
    )
    .select("projectId, userId");
}

/**
 * Removes an employee from a project's members.
 * @mcp action destructive
 */
export async function removeProjectMember(
  client: Client,
  args: { projectId: string; userId: string; companyId: string }
) {
  return client
    .from("projectMember")
    .delete()
    .eq("projectId", args.projectId)
    .eq("userId", args.userId)
    .eq("companyId", args.companyId);
}

const TIMESHEET_REVISION_COLUMNS =
  "id, timesheetEntryId, employeeId, revisedBy, revisedAt, reason, before, after, reviser:user!timesheetEntryRevision_revisedBy_fkey(id, fullName, avatarUrl)" as const;

/**
 * Lists the revisions of one timesheet entry, oldest first: who changed it,
 * when, why, and the fields before and after.
 * @mcp read
 */
export async function getTimesheetRevisions(
  client: Client,
  args: { companyId: string; timesheetEntryId: string }
) {
  return client
    .from("timesheetEntryRevision")
    .select(TIMESHEET_REVISION_COLUMNS)
    .eq("companyId", args.companyId)
    .eq("timesheetEntryId", args.timesheetEntryId)
    .order("revisedAt", { ascending: true });
}

/**
 * Lists an employee's entries in Pending Employee Review, each with its
 * latest revision (the change the employee must accept).
 * @mcp read
 */
export async function getPendingReviewEntries(
  client: Client,
  args: { companyId: string; employeeId: string }
) {
  const entries = await client
    .from("timesheetEntry")
    .select(
      "id, entryDate, hours, projectId, projectElementId, laborCategoryId, note, project:project!timesheetEntry_project_fkey(id, name, identifier), element:projectElement!timesheetEntry_element_fkey(id, readableId, name)"
    )
    .eq("companyId", args.companyId)
    .eq("employeeId", args.employeeId)
    .eq("status", "Pending Employee Review")
    .order("entryDate", { ascending: true });
  if (entries.error) return { data: null, error: entries.error };
  if (entries.data.length === 0) return { data: [], error: null };

  const revisions = await client
    .from("timesheetEntryRevision")
    .select(TIMESHEET_REVISION_COLUMNS)
    .eq("companyId", args.companyId)
    .in(
      "timesheetEntryId",
      entries.data.map((entry) => entry.id)
    )
    .order("revisedAt", { ascending: false });
  if (revisions.error) return { data: null, error: revisions.error };

  const latest = new Map<string, (typeof revisions.data)[number]>();
  for (const revision of revisions.data) {
    if (!latest.has(revision.timesheetEntryId)) {
      latest.set(revision.timesheetEntryId, revision);
    }
  }
  return {
    data: entries.data.map((entry) => ({
      ...entry,
      revision: latest.get(entry.id) ?? null
    })),
    error: null
  };
}

/**
 * The employee accepts entries that another user changed: each goes back to
 * Draft, with one revision "Accepted by employee". Refuses an entry that is
 * not the employee's or not in Pending Employee Review. Kysely bypasses RLS:
 * the caller passes the signed-in employee as `employeeId`.
 */
export async function acceptTimesheetReview(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; employeeId: string; ids: string[]; userId: string }
) {
  if (args.ids.length === 0) return [];
  return db.transaction().execute(async (trx) => {
    const entries = await trx
      .selectFrom("timesheetEntry")
      .select([
        "id",
        "employeeId",
        "status",
        "hours",
        "projectElementId",
        "laborCategoryId",
        "entryDate"
      ])
      .where("id", "in", args.ids)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .execute();
    if (entries.length !== new Set(args.ids).size) {
      throw new Error("A timesheet entry does not exist");
    }
    if (entries.some((entry) => entry.employeeId !== args.employeeId)) {
      throw new Error("You can accept changes to your own timesheet only");
    }
    if (entries.some((entry) => entry.status !== "Pending Employee Review")) {
      throw new Error(
        "Only an entry in Pending Employee Review can be accepted"
      );
    }

    const now = datetime.timestamp();
    await trx
      .updateTable("timesheetEntry")
      .set({ status: "Draft", updatedBy: args.userId, updatedAt: now })
      .where("id", "in", args.ids)
      .where("companyId", "=", args.companyId)
      .execute();
    await trx
      .insertInto("timesheetEntryRevision")
      .values(
        entries.map((entry) => {
          const fields = toJson({
            hours: Number(entry.hours),
            projectElementId: entry.projectElementId,
            laborCategoryId: entry.laborCategoryId,
            entryDate: entry.entryDate
          });
          return {
            companyId: args.companyId,
            timesheetEntryId: entry.id,
            employeeId: entry.employeeId,
            revisedBy: args.userId,
            reason: "Accepted by employee",
            before: fields ?? null,
            after: fields ?? null
          };
        })
      )
      .execute();
    return entries.map((entry) => entry.id);
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

  // The entries the corrections replace, for a labor transfer's "from".
  const correctedIds = [
    ...new Set(
      (entries.data ?? []).flatMap((entry) =>
        entry.correctionOfId ? [entry.correctionOfId] : []
      )
    )
  ];
  const originals =
    correctedIds.length > 0
      ? await client
          .from("timesheetEntry")
          .select(
            "id, projectId, projectElementId, project:project!timesheetEntry_project_fkey(identifier, name), element:projectElement!timesheetEntry_element_fkey(readableId, name)"
          )
          .eq("companyId", companyId)
          .in("id", correctedIds)
      : { data: [], error: null };
  if (originals.error) return { data: null, error: originals.error };
  const originalById = new Map(
    (originals.data ?? []).map((original) => [original.id, original])
  );

  const groups = new Map<
    string,
    {
      key: string;
      employeeId: string;
      employee: TimesheetApprovalEntry["employee"];
      weekStart: string;
      entries: (TimesheetApprovalEntry & {
        correctionOf: (typeof originals.data)[number] | null;
      })[];
      totalHours: number;
    }
  >();
  for (const row of entries.data ?? []) {
    const entry = {
      ...row,
      correctionOf: row.correctionOfId
        ? (originalById.get(row.correctionOfId) ?? null)
        : null
    };
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
  "id, employeeId, entryDate, projectId, projectElementId, laborCategoryId, hours, note, status, submittedAt, reversalOfId, correctionOfId, correctionReason, createdBy, employee:user!timesheetEntry_employeeId_fkey(id, fullName, avatarUrl), project:project!timesheetEntry_project_fkey!inner(id, identifier, name, ownerId), element:projectElement!timesheetEntry_element_fkey(id, readableId, name, isLeave), laborCategory:laborCategory!timesheetEntry_category_fkey(id, name)" as const;

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
  "id, parentId, sortOrder, readableId, name, type, budget, estimateAtCompletion, isPreproduction" as const;

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

/**
 * Gets the burden of a project per element and indirect pool, with its
 * unallowable part (government contracting Phase 5b). Empty for a project
 * the burden run never burdened.
 * @mcp read
 */
export async function getProjectBurdenSummary(
  client: Client,
  projectId: string,
  companyId: string
) {
  return client.rpc("get_project_burden_summary", {
    p_project_id: projectId,
    p_company_id: companyId
  });
}

// One row per service order whose Service project has this project as its
// parent (the coverage contract's project): its actual cost, posted hours, and
// billed and unbilled amounts.
// Each row also carries the order's subject serial (one more query for every
// order, never one per row).
export async function getChildServiceProjectCosts(
  client: Client,
  projectId: string,
  companyId: string
) {
  const costs = await client.rpc("get_child_service_project_costs", {
    p_project_id: projectId,
    p_company_id: companyId
  });
  if (costs.error) return { data: null, error: costs.error };

  const rows = costs.data ?? [];
  if (rows.length === 0) return { data: [], error: null };

  const serials = await client
    .from("serviceOrder")
    .select(
      "id, trackedEntity:trackedEntity!serviceOrder_trackedEntityId_fkey(readableId)"
    )
    .in(
      "id",
      rows.map((row) => row.serviceOrderId)
    )
    .eq("companyId", companyId);
  if (serials.error) return { data: null, error: serials.error };

  const serialByOrder = new Map(
    (serials.data ?? []).map((order) => [
      order.id,
      order.trackedEntity?.readableId ?? null
    ])
  );
  return {
    data: rows.map((row) => ({
      ...row,
      serial: serialByOrder.get(row.serviceOrderId) ?? null
    })),
    error: null
  };
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

// --- Project stock transfers ---------------------------------------------------

const PROJECT_STOCK_TRANSFER_COLUMNS =
  "*, fromProject:project!projectStockTransfer_from_fkey(id, identifier, name), toProject:project!projectStockTransfer_to_fkey(id, identifier, name)";

/**
 * Lists the project stock transfers of the company, newest first. With a
 * project, only the transfers from or to it.
 * @mcp read
 */
export async function getProjectStockTransfers(
  client: Client,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    projectId?: string | null;
  }
) {
  let query = client
    .from("projectStockTransfer")
    .select(PROJECT_STOCK_TRANSFER_COLUMNS, { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `projectStockTransferId.ilike.%${args.search}%,reason.ilike.%${args.search}%`
    );
  }

  if (args.projectId) {
    query = query.or(
      `fromProjectId.eq.${args.projectId},toProjectId.eq.${args.projectId}`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false }
  ]);

  return query;
}

/**
 * Loads one project stock transfer with its owners.
 * @mcp read
 */
export async function getProjectStockTransfer(
  client: Client,
  companyId: string,
  id: string
) {
  return client
    .from("projectStockTransfer")
    .select(PROJECT_STOCK_TRANSFER_COLUMNS)
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

/**
 * Lists the lines of a project stock transfer, oldest first.
 * @mcp read
 */
export async function getProjectStockTransferLines(
  client: Client,
  companyId: string,
  projectStockTransferId: string
) {
  return client
    .from("projectStockTransferLine")
    .select("*, storageUnit(id, name), trackedEntity(id, readableId)")
    .eq("projectStockTransferId", projectStockTransferId)
    .eq("companyId", companyId)
    .order("createdAt")
    .order("id");
}

type ProjectStockTransferFields = {
  type: ProjectStockTransferType;
  fromProjectId: string | null;
  toProjectId: string | null;
  locationId: string;
  reason: string;
  paybackDueDate: string | null;
  settlesBorrowId: string | null;
};

/**
 * Creates a Draft project stock transfer with the next readable id, or
 * updates a Draft one. A transfer past Draft is not changed.
 * @mcp upsert
 */
export async function upsertProjectStockTransfer(
  client: Client,
  transfer:
    | (ProjectStockTransferFields & { companyId: string; createdBy: string })
    | (Omit<ProjectStockTransferFields, "type"> & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in transfer) {
    const sequence = await client.rpc("get_next_sequence", {
      sequence_name: "projectStockTransfer",
      company_id: transfer.companyId
    });
    if (sequence.error || !sequence.data) {
      return refusal("Failed to get the next transfer id");
    }
    return client
      .from("projectStockTransfer")
      .insert({ ...transfer, projectStockTransferId: sequence.data })
      .select("id")
      .single();
  }

  const { id, companyId, ...update } = transfer;
  const updated = await client
    .from("projectStockTransfer")
    .update({ ...update, updatedAt: datetime.timestamp() })
    .eq("id", id)
    .eq("companyId", companyId)
    .eq("status", "Draft")
    .select("id")
    .maybeSingle();
  if (updated.error) return updated;
  if (!updated.data) return refusal("Only a Draft transfer can be changed");
  return { data: updated.data, error: null };
}

/** Refuses a line change on a transfer past Draft. */
async function requireDraftProjectStockTransfer(
  client: Client,
  companyId: string,
  projectStockTransferId: string
) {
  const header = await client
    .from("projectStockTransfer")
    .select("status")
    .eq("id", projectStockTransferId)
    .eq("companyId", companyId)
    .single();
  if (header.error) return header.error.message;
  if (header.data.status !== "Draft") {
    return "Only a Draft transfer can be changed";
  }
  return null;
}

/**
 * Adds or changes a line of a Draft project stock transfer.
 * @mcp upsert
 */
export async function upsertProjectStockTransferLine(
  client: Client,
  line: Omit<z.infer<typeof projectStockTransferLineValidator>, "id"> & {
    id?: string;
    projectStockTransferId: string;
    companyId: string;
    userId: string;
  }
) {
  const draftError = await requireDraftProjectStockTransfer(
    client,
    line.companyId,
    line.projectStockTransferId
  );
  if (draftError) return refusal(draftError);

  const fields = {
    itemId: line.itemId,
    quantity: line.quantity,
    storageUnitId: line.storageUnitId ?? null,
    trackedEntityId: line.trackedEntityId ?? null
  };

  if (line.id) {
    return client
      .from("projectStockTransferLine")
      .update({
        ...fields,
        updatedBy: line.userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", line.id)
      .eq("projectStockTransferId", line.projectStockTransferId)
      .eq("companyId", line.companyId)
      .select("id")
      .single();
  }

  return client
    .from("projectStockTransferLine")
    .insert({
      ...fields,
      projectStockTransferId: line.projectStockTransferId,
      companyId: line.companyId,
      createdBy: line.userId
    })
    .select("id")
    .single();
}

/**
 * Removes a line from a Draft project stock transfer.
 * @mcp delete
 */
export async function deleteProjectStockTransferLine(
  client: Client,
  args: { id: string; projectStockTransferId: string; companyId: string }
) {
  const draftError = await requireDraftProjectStockTransfer(
    client,
    args.companyId,
    args.projectStockTransferId
  );
  if (draftError) return refusal(draftError);

  return client
    .from("projectStockTransferLine")
    .delete()
    .eq("id", args.id)
    .eq("projectStockTransferId", args.projectStockTransferId)
    .eq("companyId", args.companyId);
}

/**
 * Approves a Draft project stock transfer, or cancels a Draft or Approved
 * one. Approval refuses a transfer without lines, and moves the
 * government-furnished refusal of posting up to approval.
 * @mcp action
 */
export async function updateProjectStockTransferStatus(
  client: Client,
  args: {
    id: string;
    companyId: string;
    userId: string;
    action: Exclude<ProjectStockTransferAction, "post">;
  }
) {
  const transfer = await getProjectStockTransfer(
    client,
    args.companyId,
    args.id
  );
  if (transfer.error) return transfer;
  if (
    !projectStockTransferActionFrom[args.action].includes(transfer.data.status)
  ) {
    return refusal(`This transfer is ${transfer.data.status}`);
  }

  if (args.action === "cancel") {
    return client
      .from("projectStockTransfer")
      .update({
        status: "Cancelled",
        updatedBy: args.userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", args.id)
      .eq("companyId", args.companyId)
      .in("status", projectStockTransferActionFrom.cancel)
      .select("id")
      .single();
  }

  // A Payback's owners come from the borrow it settles.
  let fromProjectId = transfer.data.fromProjectId;
  let toProjectId = transfer.data.toProjectId;
  if (transfer.data.type === "Payback" && transfer.data.settlesBorrowId) {
    const borrow = await client
      .from("projectBorrow")
      .select("borrowerProjectId, lenderProjectId, status")
      .eq("id", transfer.data.settlesBorrowId)
      .eq("companyId", args.companyId)
      .single();
    if (borrow.error) return borrow;
    if (borrow.data.status !== "Open") {
      return refusal("The borrow is already paid back");
    }
    fromProjectId = borrow.data.borrowerProjectId;
    toProjectId = borrow.data.lenderProjectId;
  }

  const ownerIds = [fromProjectId, toProjectId].filter((id): id is string =>
    Boolean(id)
  );
  const [lines, owners] = await Promise.all([
    client
      .from("projectStockTransferLine")
      .select("id", { count: "exact", head: true })
      .eq("projectStockTransferId", args.id)
      .eq("companyId", args.companyId),
    ownerIds.length > 0
      ? client
          .from("project")
          .select("id, identifier, name, customerId, governmentFurnished")
          .in("id", ownerIds)
          .eq("companyId", args.companyId)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (lines.error) return refusal(lines.error.message);
  if (owners.error) return refusal(owners.error.message);
  if (!lines.count) return refusal("Add a line before you approve");

  const governmentFurnished = governmentFurnishedRefusal(
    owners.data?.find((p) => p.id === fromProjectId),
    owners.data?.find((p) => p.id === toProjectId)
  );
  if (governmentFurnished) return refusal(governmentFurnished);

  const now = datetime.timestamp();
  return client
    .from("projectStockTransfer")
    .update({
      status: "Approved",
      approvedBy: args.userId,
      approvedAt: now,
      updatedBy: args.userId,
      updatedAt: now
    })
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .eq("status", "Draft")
    .select("id")
    .single();
}

/**
 * Lists the borrows of the company, oldest due first. With a project, the
 * borrows it owes or lent; with statuses, only those.
 * @mcp read
 */
export async function getProjectBorrows(
  client: Client,
  companyId: string,
  args: {
    projectId?: string | null;
    status?: ProjectBorrowStatus[] | null;
    /** Only the borrows at this location. */
    locationId?: string | null;
    /** Only the borrows due before this date (`YYYY-MM-DD`): the overdue
     *  ones, when it is today. */
    dueBefore?: string | null;
  }
) {
  let query = client
    .from("projectBorrow")
    .select(
      "*, borrower:project!projectBorrow_borrower_fkey(id, identifier, name), lender:project!projectBorrow_lender_fkey(id, identifier, name)"
    )
    .eq("companyId", companyId);

  if (args.projectId) {
    query = query.or(
      `borrowerProjectId.eq.${args.projectId},lenderProjectId.eq.${args.projectId}`
    );
  }

  if (args.status && args.status.length > 0) {
    query = query.in("status", args.status);
  }

  if (args.locationId) {
    query = query.eq("locationId", args.locationId);
  }

  if (args.dueBefore) {
    query = query.lt("paybackDueDate", args.dueBefore);
  }

  return query.order("paybackDueDate").order("createdAt");
}

/**
 * The Standard projects that keep project stock: the stock owners the
 * transfer pickers and the inventory owner filter offer, beside common stock.
 */
export async function getStockOwnerProjects(client: Client, companyId: string) {
  return client
    .from("project")
    .select("id, identifier, name, status, customerId, governmentFurnished")
    .eq("companyId", companyId)
    .eq("projectType", "Standard")
    .eq("projectStock", true)
    .eq("active", true)
    .order("identifier");
}

// ---------------------------------------------------------------------------
// Government Contracting 5a reports. Each read takes the Kysely client from
// the route, which checks the report's permissions first (Kysely applies no
// RLS), and filters every table on `companyId`. Timestamps are read as text
// on the company's calendar, so no JavaScript `Date` reaches the CSV.
// ---------------------------------------------------------------------------

type ReportRange = { companyId: string; from: string; to: string };

/** The charge number columns of a report row (`reportChargeNumber`). */
type ReportChargeColumns = {
  projectIdentifier: string | null;
  projectName: string | null;
  elementReadableId: string | null;
  elementName: string | null;
};

/** Entries dated in the range that carry a late reason. */
export async function getLateTimesheetEntries(
  db: Kysely<KyselyDatabase>,
  args: ReportRange
) {
  const result = await sql<
    ReportChargeColumns & {
      id: string;
      employeeName: string | null;
      entryDate: string;
      createdDate: string;
      hours: number;
      status: string;
      lateReason: string;
    }
  >`
    SELECT t."id", u."fullName" AS "employeeName", t."entryDate",
      (t."createdAt" AT TIME ZONE c."timezone")::date AS "createdDate",
      t."hours", t."status"::text AS "status", t."lateReason",
      p."identifier" AS "projectIdentifier", p."name" AS "projectName",
      e."readableId" AS "elementReadableId", e."name" AS "elementName"
    FROM "timesheetEntry" t
    JOIN "company" c ON c."id" = t."companyId"
    JOIN "project" p ON p."id" = t."projectId" AND p."companyId" = t."companyId"
    LEFT JOIN "projectElement" e
      ON e."id" = t."projectElementId" AND e."companyId" = t."companyId"
    LEFT JOIN "user" u ON u."id" = t."employeeId"
    WHERE t."companyId" = ${args.companyId}
      AND t."lateReason" IS NOT NULL
      AND t."entryDate" BETWEEN ${args.from}::date AND ${args.to}::date
    ORDER BY t."entryDate", u."fullName", t."createdAt"
  `.execute(db);
  return result.rows;
}

/** The scheduled work days in the range with no entry, with the manager. */
export async function getMissingTimesheetDays(
  db: Kysely<KyselyDatabase>,
  args: ReportRange
) {
  const result = await sql<{
    employeeId: string;
    employeeName: string | null;
    date: string;
    managerName: string | null;
  }>`
    SELECT m."employeeId", u."fullName" AS "employeeName", m."date",
      mu."fullName" AS "managerName"
    FROM get_missing_timesheet_days(${args.companyId}, ${args.from}::date, ${args.to}::date) m
    LEFT JOIN "user" u ON u."id" = m."employeeId"
    LEFT JOIN "user" mu ON mu."id" = m."managerId"
    ORDER BY m."date", u."fullName", m."employeeId"
  `.execute(db);
  return result.rows;
}

/**
 * Labor transfers made in the range: replacement entries (`correctionOfId`)
 * whose project or element differs from the entry they correct.
 */
export async function getLaborTransfers(
  db: Kysely<KyselyDatabase>,
  args: ReportRange
) {
  const result = await sql<{
    id: string;
    transferDate: string;
    employeeName: string | null;
    entryDate: string;
    hours: number;
    fromProjectIdentifier: string | null;
    fromElementReadableId: string | null;
    toProjectIdentifier: string | null;
    toElementReadableId: string | null;
    reason: string | null;
    requesterName: string | null;
    approverName: string | null;
    approvedDate: string | null;
    daysAfterEntry: number;
  }>`
    SELECT r."id",
      (r."createdAt" AT TIME ZONE c."timezone")::date AS "transferDate",
      u."fullName" AS "employeeName", r."entryDate", r."hours",
      op."identifier" AS "fromProjectIdentifier",
      oe."readableId" AS "fromElementReadableId",
      np."identifier" AS "toProjectIdentifier",
      ne."readableId" AS "toElementReadableId",
      r."correctionReason" AS "reason",
      ru."fullName" AS "requesterName", au."fullName" AS "approverName",
      (r."approvedAt" AT TIME ZONE c."timezone")::date AS "approvedDate",
      (r."createdAt" AT TIME ZONE c."timezone")::date - r."entryDate" AS "daysAfterEntry"
    FROM "timesheetEntry" r
    JOIN "timesheetEntry" o
      ON o."id" = r."correctionOfId" AND o."companyId" = r."companyId"
    JOIN "company" c ON c."id" = r."companyId"
    LEFT JOIN "project" op ON op."id" = o."projectId" AND op."companyId" = o."companyId"
    LEFT JOIN "projectElement" oe
      ON oe."id" = o."projectElementId" AND oe."companyId" = o."companyId"
    LEFT JOIN "project" np ON np."id" = r."projectId" AND np."companyId" = r."companyId"
    LEFT JOIN "projectElement" ne
      ON ne."id" = r."projectElementId" AND ne."companyId" = r."companyId"
    LEFT JOIN "user" u ON u."id" = r."employeeId"
    LEFT JOIN "user" ru ON ru."id" = r."createdBy"
    LEFT JOIN "user" au ON au."id" = r."approvedBy"
    WHERE r."companyId" = ${args.companyId}
      AND r."correctionOfId" IS NOT NULL
      AND (r."projectId" <> o."projectId"
        OR r."projectElementId" IS DISTINCT FROM o."projectElementId")
      AND (r."createdAt" AT TIME ZONE c."timezone")::date
        BETWEEN ${args.from}::date AND ${args.to}::date
    ORDER BY "transferDate", u."fullName", r."createdAt"
  `.execute(db);
  return result.rows;
}

/**
 * The auditor's timesheet export: every entry dated in the range and every
 * revision of those entries, as one list by employee and time. A revision
 * of a deleted Draft entry is found by the entry date it records.
 */
export async function getTimesheetAuditRows(
  db: Kysely<KyselyDatabase>,
  args: ReportRange
) {
  const result = await sql<
    ReportChargeColumns & {
      rowType: "Entry" | "Revision";
      timesheetEntryId: string;
      employeeName: string | null;
      recordedAt: string;
      entryDate: string | null;
      hours: number | null;
      status: string | null;
      recordedBy: string | null;
      lateReason: string | null;
      reason: string | null;
      before: string | null;
      after: string | null;
    }
  >`
    WITH entries AS (
      SELECT t.* FROM "timesheetEntry" t
      WHERE t."companyId" = ${args.companyId}
        AND t."entryDate" BETWEEN ${args.from}::date AND ${args.to}::date
    ),
    rows AS (
      SELECT 'Entry' AS "rowType", t."id" AS "timesheetEntryId", t."employeeId",
        t."createdAt" AS "sortAt", t."entryDate", t."projectId", t."projectElementId",
        t."hours", t."status"::text AS "status", t."createdBy" AS "recordedById",
        t."lateReason", t."correctionReason" AS "reason",
        NULL::text AS "before", NULL::text AS "after"
      FROM entries t
      UNION ALL
      SELECT 'Revision', r."timesheetEntryId", r."employeeId", r."revisedAt",
        COALESCE(t."entryDate", (r."after"->>'entryDate')::date, (r."before"->>'entryDate')::date),
        t."projectId", COALESCE(r."after"->>'projectElementId', t."projectElementId"),
        (r."after"->>'hours')::numeric, NULL, r."revisedBy", NULL, r."reason",
        r."before"::text, r."after"::text
      FROM "timesheetEntryRevision" r
      LEFT JOIN "timesheetEntry" t
        ON t."id" = r."timesheetEntryId" AND t."companyId" = r."companyId"
      WHERE r."companyId" = ${args.companyId}
        AND (r."timesheetEntryId" IN (SELECT "id" FROM entries)
          OR (t."id" IS NULL AND (
            (r."after"->>'entryDate') BETWEEN ${args.from} AND ${args.to}
            OR (r."before"->>'entryDate') BETWEEN ${args.from} AND ${args.to})))
    )
    SELECT x."rowType", x."timesheetEntryId", u."fullName" AS "employeeName",
      to_char(x."sortAt" AT TIME ZONE c."timezone", 'YYYY-MM-DD HH24:MI:SS') AS "recordedAt",
      x."entryDate", x."hours", x."status", ru."fullName" AS "recordedBy",
      x."lateReason", x."reason", x."before", x."after",
      p."identifier" AS "projectIdentifier", p."name" AS "projectName",
      e."readableId" AS "elementReadableId", e."name" AS "elementName"
    FROM rows x
    JOIN "company" c ON c."id" = ${args.companyId}
    LEFT JOIN "project" p ON p."id" = x."projectId" AND p."companyId" = c."id"
    LEFT JOIN "projectElement" e ON e."id" = x."projectElementId" AND e."companyId" = c."id"
    LEFT JOIN "user" u ON u."id" = x."employeeId"
    LEFT JOIN "user" ru ON ru."id" = x."recordedById"
    ORDER BY u."fullName", x."employeeId", x."sortAt", x."rowType"
  `.execute(db);
  return result.rows;
}

/**
 * The accounting periods the labor distribution report offers, newest
 * first. Read with the Kysely client: the report needs `projects` and
 * `people` view, and the period list RLS asks for `accounting` view.
 */
export async function getLaborDistributionPeriods(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string }
) {
  return db
    .selectFrom("accountingPeriod")
    .select(["id", "startDate", "endDate"])
    .where("companyId", "=", args.companyId)
    .orderBy("startDate", "desc")
    .execute();
}

/**
 * The inputs of the labor distribution of one accounting period
 * (`buildLaborDistribution`): `projectLedger` Labor rows posted in it, grouped
 * by employee, project and element; closed timecard hours with `clockIn` in
 * it on the company's calendar; and payroll totals with `periodEnd` in it.
 * Returns null when the period is not the company's.
 */
export async function getLaborDistributionRows(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; periodId: string }
) {
  const period = await db
    .selectFrom("accountingPeriod")
    .select(["id", "startDate", "endDate"])
    .where("id", "=", args.periodId)
    .where("companyId", "=", args.companyId)
    .executeTakeFirst();
  if (!period) return null;
  const { startDate, endDate } = period;

  const [labor, timecards, payroll] = await Promise.all([
    sql<LaborDistributionLaborRow>`
      SELECT pl."employeeId", u."fullName" AS "employeeName",
        pl."projectId", p."identifier" AS "projectIdentifier", p."name" AS "projectName",
        p."costObjective", pl."projectElementId",
        e."readableId" AS "elementReadableId", e."name" AS "elementName",
        COALESCE(SUM(pl."quantity"), 0) AS "hours",
        COALESCE(SUM(pl."amount"), 0) AS "amount",
        COALESCE(SUM(pl."amount") FILTER (WHERE pl."unallowable"), 0) AS "unallowableAmount"
      FROM "projectLedger" pl
      JOIN "project" p ON p."id" = pl."projectId" AND p."companyId" = pl."companyId"
      LEFT JOIN "projectElement" e
        ON e."id" = pl."projectElementId" AND e."companyId" = pl."companyId"
      LEFT JOIN "user" u ON u."id" = pl."employeeId"
      WHERE pl."companyId" = ${args.companyId}
        AND pl."costType" = 'Labor'
        AND pl."postingDate" BETWEEN ${startDate}::date AND ${endDate}::date
      GROUP BY pl."employeeId", u."fullName", pl."projectId", p."identifier", p."name",
        p."costObjective", pl."projectElementId", e."readableId", e."name"
      ORDER BY u."fullName", p."identifier", e."readableId"
    `.execute(db),
    sql<{ employeeId: string; employeeName: string | null; hours: number }>`
      SELECT tc."employeeId", u."fullName" AS "employeeName",
        SUM(EXTRACT(EPOCH FROM tc."clockOut" - tc."clockIn") / 3600) AS "hours"
      FROM "timeCardEntry" tc
      JOIN "company" c ON c."id" = tc."companyId"
      LEFT JOIN "user" u ON u."id" = tc."employeeId"
      WHERE tc."companyId" = ${args.companyId}
        AND tc."clockOut" IS NOT NULL
        AND (tc."clockIn" AT TIME ZONE c."timezone")::date
          BETWEEN ${startDate}::date AND ${endDate}::date
      GROUP BY tc."employeeId", u."fullName"
    `.execute(db),
    sql<{
      employeeId: string;
      employeeName: string | null;
      grossWages: number;
      hoursPaid: number;
    }>`
      SELECT pt."employeeId", u."fullName" AS "employeeName",
        SUM(pt."grossWages") AS "grossWages", SUM(pt."hoursPaid") AS "hoursPaid"
      FROM "payrollPeriodTotal" pt
      LEFT JOIN "user" u ON u."id" = pt."employeeId"
      WHERE pt."companyId" = ${args.companyId}
        AND pt."periodEnd" BETWEEN ${startDate}::date AND ${endDate}::date
      GROUP BY pt."employeeId", u."fullName"
    `.execute(db)
  ]);

  return {
    period,
    labor: labor.rows,
    timecards: timecards.rows,
    payroll: payroll.rows
  };
}

/**
 * Cost by CLIN: per current contract line with a `lineItemNumber`, the cost
 * posted in the range to its billing element's subtree, allowable and
 * unallowable apart. Funded cost, funded amount and the billed amount are
 * the line's totals.
 */
export async function getCostByClin(
  db: Kysely<KyselyDatabase>,
  args: ReportRange
) {
  const result = await sql<{
    contractReadableId: string;
    contractName: string | null;
    customerName: string | null;
    lineItemNumber: string;
    description: string | null;
    elementReadableId: string | null;
    allowableCost: number;
    unallowableCost: number;
    fundedCost: number | null;
    fundedAmount: number | null;
    billedAmount: number;
  }>`
    WITH lines AS (
      SELECT l.* FROM "customerContractLine" l
      WHERE l."companyId" = ${args.companyId}
        AND l."lineItemNumber" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "customerContractLine" n
          WHERE n."amendsLineId" = l."id" AND n."companyId" = l."companyId"
        )
    ),
    costs AS (
      SELECT s."customerContractLineId" AS "lineId",
        COALESCE(SUM(pl."amount") FILTER (WHERE NOT pl."unallowable"), 0) AS "allowable",
        COALESCE(SUM(pl."amount") FILTER (WHERE pl."unallowable"), 0) AS "unallowable"
      FROM get_contract_line_subtree(${args.companyId}, ARRAY(SELECT "id" FROM lines)) s
      JOIN "projectLedger" pl
        ON pl."projectElementId" = s."projectElementId" AND pl."companyId" = ${args.companyId}
      WHERE pl."postingDate" BETWEEN ${args.from}::date AND ${args.to}::date
      GROUP BY s."customerContractLineId"
    ),
    billed AS (
      SELECT b."customerContractLineId" AS "lineId", SUM(b."amount") AS "billed"
      FROM "projectBillableItem" b
      WHERE b."companyId" = ${args.companyId}
        AND b."status" = 'Billed'
        AND b."customerContractLineId" IN (SELECT "id" FROM lines)
      GROUP BY b."customerContractLineId"
    )
    SELECT cc."customerContractId" AS "contractReadableId", cc."name" AS "contractName",
      cu."name" AS "customerName", l."lineItemNumber",
      COALESCE(l."description", i."name") AS "description",
      e."readableId" AS "elementReadableId",
      COALESCE(co."allowable", 0) AS "allowableCost",
      COALESCE(co."unallowable", 0) AS "unallowableCost",
      l."fundedCost", l."fundedAmount", COALESCE(b."billed", 0) AS "billedAmount"
    FROM lines l
    JOIN "customerContract" cc
      ON cc."id" = l."customerContractId" AND cc."companyId" = l."companyId"
    LEFT JOIN "customer" cu ON cu."id" = cc."customerId" AND cu."companyId" = cc."companyId"
    LEFT JOIN "item" i ON i."id" = l."itemId" AND i."companyId" = l."companyId"
    LEFT JOIN "projectElement" e
      ON e."id" = l."projectElementId" AND e."companyId" = l."companyId"
    LEFT JOIN costs co ON co."lineId" = l."id"
    LEFT JOIN billed b ON b."lineId" = l."id"
    ORDER BY cc."customerContractId", l."lineItemNumber"
  `.execute(db);
  return result.rows;
}
