// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { LIST_COUNT, setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  ProjectCostTreatment,
  ProjectStatus,
  projectLabelValidator,
  projectMilestoneValidator,
  projectStateValidator,
  projectValidator
} from "./projects.models";

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
 * Lists the active projects of the company.
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
