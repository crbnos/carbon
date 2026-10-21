// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHash } from "node:crypto";
import {
  InvalidInputError,
  NotFoundError,
  ServerFnError
} from "@carbon/api/errors";
import type { PermissionRule } from "@carbon/api/permissions";
import {
  type PostTimesheetResult,
  postTimesheetInput,
  type SaveTimesheetEntryResult,
  type SubmitTimesheetWeekResult,
  saveTimesheetEntryInput,
  submitTimesheetWeekInput
} from "@carbon/api/postings";
import type { PostProjectBurdenResult } from "@carbon/api/postings.server";
import type { ServiceContext } from "@carbon/api/service-fn.server";
import {
  assertEntitiesInStripes,
  loadDemandStripes,
  type StripeQuantity,
  splitAcrossStripes,
  trackedEntityStripe
} from "@carbon/api/stock-stripes";
import type { Database, Json } from "@carbon/database";
import {
  Constants,
  getCompanyTimeZone,
  journalReference
} from "@carbon/database";
import type {
  KyselyDatabase as DB,
  Kysely,
  KyselyDatabase
} from "@carbon/database/client";
import { fetchAll } from "@carbon/database/fetch-all";
import { journalPostingStatus } from "@carbon/database/journal-posting-status";
import { toJson } from "@carbon/database/json";
import { completedAtForGroup } from "@carbon/database/project-plan";
import { inOrder, rpcRows, single } from "@carbon/database/rows";
import {
  accountTypeFromClass,
  BILLABLE_REASON_NO_BILL_RATE,
  buildJournalLineDimensionInserts,
  certificationTextFor,
  credit,
  datetime,
  debit,
  dilutionFactor,
  equals,
  heldProjectRefusal,
  isEntryDateAllowed,
  isUniqueViolation,
  isValidWbsCode,
  nextEntryStatus,
  type RdActivityRole,
  round,
  type ServiceCoverage,
  settleQuantity,
  TIMESHEET_REFUSAL_NOT_DRAFT,
  type TimesheetEntryStatus,
  timecardShortfall
} from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Insertable, Selectable, Transaction } from "kysely";
import { sql } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  allocateJournalLineIds,
  assertCompanyRecords,
  bookAdjustment,
  buildAdjustmentJournalLines,
  buildCostLedgerRow,
  buildItemLedgerRow,
  buildJournalLineDimensions,
  calculateCOGS,
  createAdjustmentJournal,
  resolveAccountingPeriod
} from "~/modules/shared/shared.service";
import type { GenericQueryFilters } from "~/utils/query";
import { LIST_COUNT, setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { updateSortOrder } from "../shared/sort-order";
import { buildProjectCipRow, writeProjectCipRows } from "./project-cip";
import { postProjectJournal } from "./project-journal";
import {
  assertChargeable,
  buildBillableItem,
  buildProjectLedgerRow,
  insertProjectLedgerRows,
  isUnallowableCharge,
  loadProjectPostingContexts,
  loadServicePostingContext,
  loadServicePostingContexts,
  ProjectChargeError,
  projectPostingKey,
  resolveProjectPostingAccount,
  resolveProjectTreatment,
  reverseBillableItem,
  type ServicePostingContext,
  serviceChargeCoverage,
  startElementsOnFirstCharge
} from "./project-posting";
import type {
  BillableItemAction,
  ItemValues,
  LaborDistributionLaborRow,
  laborCategoryRateValidator,
  laborCategoryValidator,
  ProjectBorrowStatus,
  ProjectCostTreatment,
  ProjectCostType,
  ProjectElementEditableField,
  ProjectElementType,
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
  projectValidator,
  RdEmployeeYear,
  RdLedgerRow
} from "./projects.models";
import {
  apportionedBaseRefusal,
  canLink,
  elementDeleteRefusal,
  governmentFurnishedRefusal,
  PARAMETER_ITEM_UNIT_COST,
  parameterSources,
  projectStockTransferActionFrom,
  rdComponentTypes,
  rdSoftwareTypes,
  requirementCategories,
  requirementTargetOperators,
  requirementVerificationMethods,
  stopWorkStatusRefusal,
  suspectLinkFields,
  testCaseVerdicts,
  typeSpecificElementFields,
  weekStartOf
} from "./projects.models";
import {
  findServiceIssueToReturn,
  installServicePart,
  type ServiceIssue,
  uninstallServicePart
} from "./service-part-issue";
import { paybackVariance, planBorrowMatching } from "./stock-transfer-plan";
import {
  type DilutionPostedEntry,
  planDilution,
  planRedilutionPostings,
  planTimesheetPosting,
  type TimesheetJournalLine,
  type TimesheetLedgerRow,
  type TimesheetOriginal,
  type TimesheetPostingEntry
} from "./timesheet-posting-plan";
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
 * The projects the project workspace's switcher lists: id, identifier and
 * name of the active Standard projects that are not templates, by
 * identifier, at most 200.
 * @mcp read
 */
export async function getProjectSwitcherOptions(
  client: Client,
  companyId: string
) {
  return client
    .from("project")
    .select("id, identifier, name")
    .eq("companyId", companyId)
    .eq("projectType", "Standard")
    .eq("active", true)
    .eq("isTemplate", false)
    .order("identifier", { ascending: true })
    .limit(200);
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
 * Changes the status of a project. Refuses any status but On Hold while the
 * project has a stop-work order (use Resume). Closing refuses while the
 * project has an open purchase order line or an open job.
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
  if (args.status !== "On Hold") {
    const project = await client
      .from("project")
      .select("stopWorkDate")
      .eq("id", args.id)
      .eq("companyId", args.companyId)
      .single();
    if (project.error) return { data: null, error: project.error };
    const stopped = stopWorkStatusRefusal(
      project.data.stopWorkDate,
      args.status
    );
    if (stopped) return refusal(stopped);
  }

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
 * Lists the company's project states in board order. States are
 * company-wide: every project and service order uses them.
 * @mcp read
 */
export async function getProjectStates(client: Client, companyId: string) {
  return client
    .from("projectState")
    .select("*")
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true });
}

type ProjectStateFields = Omit<z.infer<typeof projectStateValidator>, "id">;

/**
 * Creates or updates a project state of the company. A new state goes after
 * the last state.
 * @mcp upsert
 */
export async function upsertProjectState(
  client: Client,
  state:
    | (ProjectStateFields & {
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
      .eq("companyId", state.companyId)
      .order("sortOrder", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last.error) return { data: null, error: last.error };

    return client
      .from("projectState")
      .insert([
        {
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
 * Deletes a project state of the company. Refuses when an element of any
 * project uses the state or when it is the last state of its group. When the
 * state is its group's default, the next state of the group becomes the
 * default.
 * @mcp delete
 */
export async function deleteProjectState(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; id: string }
) {
  try {
    await db.transaction().execute(async (trx) => {
      const state = await trx
        .selectFrom("projectState")
        .select(["id", "group", "isDefault"])
        .where("id", "=", args.id)
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
        .where("companyId", "=", args.companyId)
        .where("group", "=", state.group)
        .where("id", "<>", args.id)
        .orderBy("sortOrder", "asc")
        .limit(1)
        .executeTakeFirst();
      if (!next) {
        throw new Error(
          `This is the last ${state.group} state. Projects need one state in each group.`
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
  args: { companyId: string; id: string; updatedBy: string }
) {
  try {
    await db.transaction().execute(async (trx) => {
      const state = await trx
        .selectFrom("projectState")
        .select(["id", "group"])
        .where("id", "=", args.id)
        .where("companyId", "=", args.companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!state) throw new Error("The state does not exist");

      await trx
        .updateTable("projectState")
        .set({ isDefault: false })
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
 * Lists the company's project labels. Labels are company-wide.
 * @mcp read
 */
export async function getProjectLabels(client: Client, companyId: string) {
  return client
    .from("projectLabel")
    .select("*")
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("name", { ascending: true });
}

type ProjectLabelFields = Omit<z.infer<typeof projectLabelValidator>, "id">;

/**
 * Creates or updates a project label of the company.
 * @mcp upsert
 */
export async function upsertProjectLabel(
  client: Client,
  label:
    | (ProjectLabelFields & {
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
 * Deletes a project label of the company. Its element links go with it.
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
  "id, projectId, readableId, sequence, wbsCode, type, parentId, name, stateId, ownerId, priority, milestoneId, startDate, targetDate, completedAt, estimatedHours, isChargeable, isUnallowable, isBusinessComponent, isControlAccount, earnedValueTechnique, budget, itemId, sortOrder, createdAt, updatedAt, requirementCategory, targetOperator, targetValue, targetUpperValue, targetUnit, verificationMethod, actualParameterId, qualityDocumentId, verdict, verdictAt, verdictBy, parameterValue, parameterUnit, parameterSource, parameterFormula, parameterItemField, parameterContingencyPercent, allocationPercent, state:projectState!projectElement_state_fkey!inner(name, group, color), labels:projectElementLabel!projectElementLabel_element_fkey(projectLabelId)" as const;

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

/**
 * Every element of a project as `computeWbsCodes` needs it. The element list
 * may be filtered, so the codes are always computed from this full tree.
 */
export async function getProjectWbsNodes(
  client: Client,
  projectId: string,
  companyId: string
) {
  return fetchAll<{
    id: string;
    parentId: string | null;
    type: ProjectElementType;
    sortOrder: number;
    sequence: number;
    wbsCode: string | null;
  }>(() =>
    client
      .from("projectElement")
      .select("id, parentId, type, sortOrder, sequence, wbsCode")
      .eq("projectId", projectId)
      .eq("companyId", companyId)
      .order("id", { ascending: true })
  );
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
/**
 * A billing element bills its whole subtree, so a branch has at most one: an
 * element and its ancestors cannot both be billing elements (projects spec,
 * *Billing flag*). Refuses a Parameter too, which takes no charges. Reads the
 * elements of the projects once.
 */
async function refuseBillingInBranch(
  client: Client,
  ids: string[],
  companyId: string
) {
  const targets = await client
    .from("projectElement")
    .select("id, projectId, readableId, type")
    .in("id", ids)
    .eq("companyId", companyId);
  if (targets.error) return { data: null, error: targets.error };
  const parameter = targets.data.find((e) => e.type === "Parameter");
  if (parameter) {
    return refusal(
      `${parameter.readableId} is a Parameter, which takes no charges`
    );
  }
  const projectIds = [...new Set(targets.data.map((e) => e.projectId))];
  const all = await client
    .from("projectElement")
    .select("id, parentId, isBilling, readableId")
    .in("projectId", projectIds)
    .eq("companyId", companyId);
  if (all.error) return { data: null, error: all.error };

  const byId = new Map(all.data.map((e) => [e.id, e]));
  const billing = new Set(all.data.filter((e) => e.isBilling).map((e) => e.id));
  for (const id of ids) billing.add(id);
  const ancestors = (id: string) => {
    const found: string[] = [];
    const seen = new Set<string>([id]);
    let current = byId.get(id)?.parentId ?? null;
    while (current && !seen.has(current)) {
      found.push(current);
      seen.add(current);
      current = byId.get(current)?.parentId ?? null;
    }
    return found;
  };
  for (const id of billing) {
    const above = ancestors(id).find((ancestor) => billing.has(ancestor));
    if (above) {
      const label = (key: string) => byId.get(key)?.readableId ?? key;
      return refusal(
        `${label(id)} sits under the billing element ${label(above)}. A branch has one billing element`
      );
    }
  }
  return null;
}

/** An element a contract line bills stays a billing element. */
async function refuseBilledElement(
  client: Client,
  ids: string[],
  companyId: string
) {
  const lines = await client
    .from("customerContractLine")
    .select(
      "id, element:projectElement!customerContractLine_projectElement_fkey(readableId)"
    )
    .in("projectElementId", ids)
    .eq("companyId", companyId)
    .limit(1);
  if (lines.error) return { data: null, error: lines.error };
  const line = lines.data[0];
  if (!line) return null;
  return refusal(
    `A contract line bills ${line.element?.readableId ?? "this element"}. It stays a billing element`
  );
}

/**
 * Makes elements billing elements, or stops them being one: the element a
 * Time & Materials or Cost Plus contract line bills, with its subtree. A
 * branch has one billing element, and an element a contract line bills
 * stays one.
 */
export async function updateProjectElementBilling(
  client: Client,
  args: {
    ids: string[];
    isBilling: boolean;
    companyId: string;
    updatedBy: string;
  }
) {
  const refused = args.isBilling
    ? await refuseBillingInBranch(client, args.ids, args.companyId)
    : await refuseBilledElement(client, args.ids, args.companyId);
  if (refused) return refused;
  return client
    .from("projectElement")
    .update({
      isBilling: args.isBilling,
      updatedBy: args.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .in("id", args.ids)
    .eq("companyId", args.companyId);
}

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
    case "wbsCode":
      // Blank unpins the code: the element derives it from the tree again.
      if (raw !== null && !isValidWbsCode(raw)) {
        return refusal(
          "A WBS code has 1 to 40 letters, digits, dots and dashes"
        );
      }
      if (raw !== null && args.ids.length > 1) {
        return refusal("Pin a WBS code on one element at a time");
      }
      if (raw !== null) {
        // A Parameter is not part of the WBS: a pinned code would hold a
        // code in the unique index that no export shows.
        const target = await client
          .from("projectElement")
          .select("type")
          .eq("id", args.ids[0]!)
          .eq("companyId", args.companyId)
          .single();
        if (target.error) return { data: null, error: target.error };
        if (target.data.type === "Parameter") {
          return refusal("A Parameter has no WBS code");
        }
      }
      update.wbsCode = raw;
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
      update.completedAt = completedAtForGroup(
        state.data.group,
        datetime.timestamp()
      );
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
    case "isBusinessComponent": {
      // R&D tax: an element that is no longer a business component has no
      // component or software type (projectElement_rdComponent_check).
      const value = raw === "true" || raw === "on";
      update.isBusinessComponent = value;
      if (!value) {
        update.rdComponentType = null;
        update.rdSoftwareType = null;
      }
      break;
    }
    case "rdComponentType":
    case "rdSoftwareType": {
      const allowed: readonly string[] =
        args.field === "rdComponentType" ? rdComponentTypes : rdSoftwareTypes;
      if (raw !== null) {
        if (!allowed.includes(raw))
          return refusal("Choose a type from the list");
        const notComponents = await client
          .from("projectElement")
          .select("id", { count: "exact", head: true })
          .in("id", args.ids)
          .eq("companyId", args.companyId)
          .eq("isBusinessComponent", false);
        if (notComponents.error) {
          return { data: null, error: notComponents.error };
        }
        if ((notComponents.count ?? 0) > 0) {
          return refusal("Mark the element as a business component first");
        }
      }
      update[args.field] = raw;
      break;
    }
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
  if (result.error) {
    if (args.field === "wbsCode" && isUniqueViolation(result.error)) {
      return refusal(`WBS code ${raw} is already pinned in this project`);
    }
    return result;
  }

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
    .select("id, name, rdActivityRole")
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
    rdActivityRole: category.rdActivityRole ?? null,
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

/**
 * The project contracts that bill a project, each with all of its lines: a
 * contract whose header names the project, and a contract with a line that
 * bills it. A line bills its own project, which may differ from the
 * header's (or the header may name none), so the header alone misses
 * contracts. Two reads, whatever the number of contracts.
 */
export async function getProjectContracts(
  client: Client,
  args: { companyId: string; projectId: string }
) {
  const [byHeader, byLine] = await Promise.all([
    client
      .from("customerContract")
      .select(
        "id, customerContractId, name, status, projectId, lines:customerContractLine!customerContractLine_contract_fkey(id, projectId, amendsLineId, billingMethod, fundedAmount, quantity, rate)"
      )
      .eq("companyId", args.companyId)
      .eq("projectId", args.projectId)
      .eq("billingBasis", "Project"),
    client
      .from("customerContractLine")
      .select(
        "contract:customerContract!customerContractLine_contract_fkey!inner(id, customerContractId, name, status, projectId, lines:customerContractLine!customerContractLine_contract_fkey(id, projectId, amendsLineId, billingMethod, fundedAmount, quantity, rate))"
      )
      .eq("companyId", args.companyId)
      .eq("projectId", args.projectId)
      .eq("contract.billingBasis", "Project")
  ]);

  const byId = new Map(
    (byHeader.data ?? []).map((contract) => [contract.id, contract])
  );
  for (const row of byLine.data ?? []) {
    if (row.contract) byId.set(row.contract.id, row.contract);
  }
  return {
    data: [...byId.values()].sort((a, b) =>
      a.customerContractId.localeCompare(b.customerContractId)
    ),
    error: byHeader.error ?? byLine.error
  };
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
  "id, employeeId, entryDate, projectId, projectElementId, laborCategoryId, workLocationId, rdActivityRole, workLocation:location!timesheetEntry_workLocationId_fkey(id, name), hours, note, status, createdAt, submittedAt, approvedAt, rejectionNote, costRate, reversalOfId, correctionReason, postedAt, project:project!timesheetEntry_project_fkey(id, identifier, name, projectType, serviceOrder!serviceOrder_project_fkey(id, serviceOrderId)), element:projectElement!timesheetEntry_element_fkey(id, readableId, name, isLeave), laborCategory:laborCategory!timesheetEntry_category_fkey(id, name)" as const;

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
    /** R&D tax: a new work location or research role for the replacement. */
    workLocationId?: string;
    rdActivityRole?: Database["public"]["Enums"]["rdActivityRole"];
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
      // R&D tax: the reversal undoes the time where and as it was done.
      workLocationId: original.workLocationId,
      rdActivityRole: original.rdActivityRole,
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

    // A held project takes no new hours: a transfer onto it, or more hours
    // on it. Fewer hours is a correction and stays allowed.
    if (
      args.hours > 0 &&
      (movesProject || args.hours > Number(original.hours))
    ) {
      const target = await trx
        .selectFrom("project")
        .select(["identifier", "name", "status", "stopWorkDate"])
        .where("id", "=", projectId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (!target) throw new Error("The project does not exist");
      const refusal = heldProjectRefusal(target, original.entryDate);
      if (refusal) throw new Error(refusal);
    }

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
          workLocationId: args.workLocationId || original.workLocationId,
          rdActivityRole: args.rdActivityRole || original.rdActivityRole,
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
 * Counts the Submitted timesheet entries of the company: the items waiting
 * in Projects → Approvals. A head-only count, no rows.
 * @mcp read
 */
export async function getTimesheetApprovalCount(
  client: Client,
  companyId: string
) {
  return client
    .from("timesheetEntry")
    .select("id", { count: "exact", head: true })
    .eq("companyId", companyId)
    .eq("status", "Submitted");
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
  "id, parentId, sortOrder, readableId, name, type, budget, estimateAtCompletion, isPreproduction, isControlAccount" as const;

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

/** One employee of the Missing Time report (`getMissingTimeByEmployee`). */
export type MissingTimeEmployee = {
  employeeId: string;
  employeeName: string | null;
  managerId: string | null;
  managerName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  locationId: string | null;
  locationName: string | null;
  /** The scheduled days with no time, oldest first (`YYYY-MM-DD`). */
  dates: string[];
};

/**
 * The Missing Time report, one row per employee. Without `excluded`: each
 * employee with missing days in the range (`get_missing_timesheet_days`),
 * most days first. With `excluded`: the active employees whose
 * `timesheetRequired` is off, who are never listed as missing.
 */
export async function getMissingTimeByEmployee(
  db: Kysely<KyselyDatabase>,
  args: ReportRange & { excluded: boolean }
) {
  const result = args.excluded
    ? await sql<MissingTimeEmployee>`
        SELECT e."id" AS "employeeId", u."fullName" AS "employeeName",
          ej."managerId", mu."fullName" AS "managerName",
          ej."departmentId", d."name" AS "departmentName",
          ej."locationId", l."name" AS "locationName",
          ARRAY[]::text[] AS "dates"
        FROM "employee" e
        JOIN "employeeJob" ej ON ej."id" = e."id" AND ej."companyId" = e."companyId"
        LEFT JOIN "user" u ON u."id" = e."id"
        LEFT JOIN "user" mu ON mu."id" = ej."managerId"
        LEFT JOIN "department" d ON d."id" = ej."departmentId" AND d."companyId" = e."companyId"
        LEFT JOIN "location" l ON l."id" = ej."locationId" AND l."companyId" = e."companyId"
        WHERE e."companyId" = ${args.companyId}
          AND e."active"
          AND NOT ej."timesheetRequired"
        ORDER BY u."fullName", e."id"
      `.execute(db)
    : await sql<MissingTimeEmployee>`
        SELECT m."employeeId", u."fullName" AS "employeeName",
          m."managerId", mu."fullName" AS "managerName",
          ej."departmentId", d."name" AS "departmentName",
          ej."locationId", l."name" AS "locationName",
          array_agg(m."date"::text ORDER BY m."date") AS "dates"
        FROM get_missing_timesheet_days(${args.companyId}, ${args.from}::date, ${args.to}::date) m
        LEFT JOIN "employeeJob" ej ON ej."id" = m."employeeId" AND ej."companyId" = ${args.companyId}
        LEFT JOIN "user" u ON u."id" = m."employeeId"
        LEFT JOIN "user" mu ON mu."id" = m."managerId"
        LEFT JOIN "department" d ON d."id" = ej."departmentId" AND d."companyId" = ${args.companyId}
        LEFT JOIN "location" l ON l."id" = ej."locationId" AND l."companyId" = ${args.companyId}
        GROUP BY m."employeeId", u."fullName", m."managerId", mu."fullName",
          ej."departmentId", d."name", ej."locationId", l."name"
        ORDER BY count(*) DESC, u."fullName", m."employeeId"
      `.execute(db);
  return result.rows;
}

/** How many active employees have `timesheetRequired` off. */
export async function getMissingTimeExcludedCount(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string }
) {
  const row = await db
    .selectFrom("employee")
    .innerJoin("employeeJob", (join) =>
      join
        .onRef("employeeJob.id", "=", "employee.id")
        .onRef("employeeJob.companyId", "=", "employee.companyId")
    )
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .where("employee.companyId", "=", args.companyId)
    .where("employee.active", "=", true)
    .where("employeeJob.timesheetRequired", "=", false)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

/**
 * Turns an employee's `timesheetRequired` on or off (the Missing Time
 * report's Exclude and Include). Returns false when the employee has no job
 * row in the company.
 */
export async function updateTimesheetRequired(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    employeeId: string;
    timesheetRequired: boolean;
    updatedBy: string;
  }
) {
  const result = await db
    .updateTable("employeeJob")
    .set({
      timesheetRequired: args.timesheetRequired,
      updatedBy: args.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .where("id", "=", args.employeeId)
    .where("companyId", "=", args.companyId)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
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

// --- R&D tax reports (Government Contracting 5d) -------------------------------

/**
 * The `projectLedger` rows posted in the range to a business component or
 * its subtree, down to the next business component (decision D5), in one
 * query. Per row: the work country (D3: the timesheet entry's work location
 * for a Timesheet row, else the project's location), the research role (the
 * entry's, else its labor category's), the project's cost objective, and
 * `funded` (D10: a Direct project with a line on a contract whose
 * `researchFunded`, else whether it has a Cost Plus or Time & Materials line).
 */
export async function getRdLedgerRows(
  db: Kysely<KyselyDatabase>,
  args: ReportRange
) {
  const result = await sql<RdLedgerRow>`
    WITH RECURSIVE bc AS (
      SELECT e."id" AS "elementId", e."id" AS "componentId", e."companyId"
      FROM "projectElement" e
      WHERE e."companyId" = ${args.companyId} AND e."isBusinessComponent"
      UNION ALL
      SELECT c."id", bc."componentId", c."companyId"
      FROM "projectElement" c
      JOIN bc ON c."parentId" = bc."elementId" AND c."companyId" = bc."companyId"
      WHERE NOT c."isBusinessComponent"
    ),
    contract_projects AS (
      SELECT cc."id" AS "contractId", cc."projectId"
      FROM "customerContract" cc
      WHERE cc."companyId" = ${args.companyId} AND cc."projectId" IS NOT NULL
      UNION
      SELECT l."customerContractId", COALESCE(l."projectId", be."projectId")
      FROM "customerContractLine" l
      LEFT JOIN "projectElement" be
        ON be."id" = l."projectElementId" AND be."companyId" = l."companyId"
      WHERE l."companyId" = ${args.companyId}
        AND COALESCE(l."projectId", be."projectId") IS NOT NULL
    ),
    funded_contracts AS (
      SELECT cc."id"
      FROM "customerContract" cc
      WHERE cc."companyId" = ${args.companyId}
        AND COALESCE(
          cc."researchFunded",
          EXISTS (
            SELECT 1 FROM "customerContractLine" l
            WHERE l."customerContractId" = cc."id"
              AND l."companyId" = cc."companyId"
              AND l."billingMethod" IN ('Cost Plus', 'Time & Materials')
          )
        )
    ),
    funded_projects AS (
      SELECT DISTINCT cp."projectId"
      FROM contract_projects cp
      JOIN funded_contracts fc ON fc."id" = cp."contractId"
    )
    SELECT bc."componentId", pl."costType", pl."documentType", pl."amount",
      pl."employeeId", COALESCE(pl."quantity", 0) AS "quantity",
      CASE WHEN pl."documentType" = 'Timesheet' THEN wl."countryCode"
        ELSE prl."countryCode" END AS "countryCode",
      COALESCE(te."rdActivityRole", lc."rdActivityRole") AS "rdActivityRole",
      p."costObjective",
      (p."costObjective" = 'Direct' AND fp."projectId" IS NOT NULL) AS "funded"
    FROM "projectLedger" pl
    JOIN bc ON bc."elementId" = pl."projectElementId" AND bc."companyId" = pl."companyId"
    JOIN "project" p ON p."id" = pl."projectId" AND p."companyId" = pl."companyId"
    LEFT JOIN "location" prl ON prl."id" = p."locationId" AND prl."companyId" = p."companyId"
    LEFT JOIN "timesheetEntry" te
      ON pl."documentType" = 'Timesheet'
      AND te."id" = pl."documentId" AND te."companyId" = pl."companyId"
    LEFT JOIN "location" wl ON wl."id" = te."workLocationId" AND wl."companyId" = te."companyId"
    LEFT JOIN "laborCategory" lc
      ON lc."id" = COALESCE(te."laborCategoryId", pl."laborCategoryId")
      AND lc."companyId" = pl."companyId"
    LEFT JOIN funded_projects fp ON fp."projectId" = p."id"
    WHERE pl."companyId" = ${args.companyId}
      AND pl."postingDate" BETWEEN ${args.from}::date AND ${args.to}::date
  `.execute(db);
  return result.rows;
}

/**
 * Per employee for the range: Posted timesheet hours (every project), the
 * gross wages of imported payroll rows whose `periodEnd` is in the range
 * (null with none), the Labor ledger amount, and the officer flag.
 */
export async function getRdEmployeeYear(
  db: Kysely<KyselyDatabase>,
  args: ReportRange
) {
  const result = await sql<RdEmployeeYear>`
    WITH hours AS (
      SELECT t."employeeId", SUM(t."hours") AS "totalHours"
      FROM "timesheetEntry" t
      WHERE t."companyId" = ${args.companyId}
        AND t."status" = 'Posted'
        AND t."entryDate" BETWEEN ${args.from}::date AND ${args.to}::date
      GROUP BY t."employeeId"
    ),
    payroll AS (
      SELECT pt."employeeId", SUM(pt."grossWages") AS "grossWages"
      FROM "payrollPeriodTotal" pt
      WHERE pt."companyId" = ${args.companyId}
        AND pt."periodEnd" BETWEEN ${args.from}::date AND ${args.to}::date
      GROUP BY pt."employeeId"
    ),
    labor AS (
      SELECT pl."employeeId", SUM(pl."amount") AS "laborAmount"
      FROM "projectLedger" pl
      WHERE pl."companyId" = ${args.companyId}
        AND pl."costType" = 'Labor'
        AND pl."employeeId" IS NOT NULL
        AND pl."postingDate" BETWEEN ${args.from}::date AND ${args.to}::date
      GROUP BY pl."employeeId"
    ),
    employees AS (
      SELECT "employeeId" FROM hours
      UNION SELECT "employeeId" FROM payroll
      UNION SELECT "employeeId" FROM labor
    )
    SELECT e."employeeId", u."fullName" AS "employeeName",
      COALESCE(h."totalHours", 0) AS "totalHours",
      pa."grossWages",
      COALESCE(l."laborAmount", 0) AS "laborAmount",
      COALESCE(ej."isOfficer", false) AS "isOfficer"
    FROM employees e
    LEFT JOIN hours h ON h."employeeId" = e."employeeId"
    LEFT JOIN payroll pa ON pa."employeeId" = e."employeeId"
    LEFT JOIN labor l ON l."employeeId" = e."employeeId"
    LEFT JOIN "employeeJob" ej
      ON ej."id" = e."employeeId" AND ej."companyId" = ${args.companyId}
    LEFT JOIN "user" u ON u."id" = e."employeeId"
  `.execute(db);
  return result.rows;
}

/**
 * The business components of the company (R&D tax): id, readable id, name,
 * component type and software type.
 * @mcp read
 */
export async function getRdComponents(client: Client, companyId: string) {
  return client
    .from("projectElement")
    .select("id, readableId, name, rdComponentType, rdSoftwareType")
    .eq("companyId", companyId)
    .eq("isBusinessComponent", true)
    .order("readableId", { ascending: true });
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

// ---------------------------------------------------------------------------
// submit-timesheet-week
//
// Submits one week of an employee's timesheet. Standard mode keeps Phase 1a
// `submitTimesheetEntries`. DCAA mode adds the review check, the total-time
// check against the timecards and the certification row.
// Spec: .ai/specs/implemented/2026-10-09-government-contracting.md (Timekeeping).

export const TIMESHEET_REVIEW_PENDING =
  "Review the changes to your timesheet first";
export const TIMESHEET_CERTIFICATION_CHANGED =
  "The certification text changed. Reload the page";
export const TIMESHEET_CERTIFICATION_MISSING =
  "Set the certification text in Settings → Time before you submit";

/** A refusal the caller can fix: returned as a 422 with its message. */
class TimesheetRefusal extends ServerFnError {
  constructor(message: string) {
    super(message, 422);
  }
}

/** "Your entries account for X h of Y h on your timecards". */
export function timecardShortfallMessage(
  entryHours: number,
  timecardHours: number
): string {
  return `Your entries account for ${round(entryHours)} h of ${round(timecardHours)} h on your timecards`;
}

/** The SHA-256 hex of a certification text, as `timesheetCertification.textHash`. */
export function certificationTextHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export const submitTimesheetWeekPermission = {
  update: "projects"
} satisfies PermissionRule<z.output<typeof submitTimesheetWeekInput>>;

/**
 * Submits an employee's Draft entries of Standard projects in the ISO week
 * that starts on `weekStart`. Service time posts from Draft and is never
 * submitted here.
 *
 * In DCAA mode it first refuses a week with a Pending Employee Review entry,
 * checks the week's entries against the timecard hours (Warn adds a warning,
 * Block refuses), refuses a certification text that is not the current one,
 * and writes a `timesheetCertification` row with the text's hash and the
 * employee's FLSA status.
 */
export async function submitTimesheetWeek(
  ctx: ServiceContext,
  raw: z.input<typeof submitTimesheetWeekInput>
): Promise<SubmitTimesheetWeekResult> {
  const input = submitTimesheetWeekInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const { employeeId, weekStart } = input;
  const weekEnd = parseDate(weekStart).add({ days: 6 }).toString();

  return db.transaction().execute(async (trx) => {
    const [settings, job] = await inOrder([
      () =>
        trx
          .selectFrom("companySettings")
          .select([
            "timekeepingControls",
            "timeCardEnabled",
            "timesheetTimecardCheck",
            "certificationTextExempt",
            "certificationTextNonExempt"
          ])
          .where("id", "=", companyId)
          .executeTakeFirst(),
      () =>
        trx
          .selectFrom("employeeJob")
          .select("flsaStatus")
          .where("id", "=", employeeId)
          .where("companyId", "=", companyId)
          .executeTakeFirst()
    ]);
    const mode = settings?.timekeepingControls ?? "Standard";

    // Row locks: a save during the submit waits for it.
    const entries = await trx
      .selectFrom("timesheetEntry")
      .innerJoin("project", (join) =>
        join
          .onRef("project.id", "=", "timesheetEntry.projectId")
          .onRef("project.companyId", "=", "timesheetEntry.companyId")
      )
      .select([
        "timesheetEntry.id",
        "timesheetEntry.status",
        "timesheetEntry.hours",
        "project.projectType"
      ])
      .where("timesheetEntry.companyId", "=", companyId)
      .where("timesheetEntry.employeeId", "=", employeeId)
      .where("timesheetEntry.entryDate", ">=", weekStart)
      .where("timesheetEntry.entryDate", "<=", weekEnd)
      .orderBy("timesheetEntry.id")
      .forUpdate("timesheetEntry")
      .execute();

    // A service order's time is posted from its visit page, never here.
    const drafts = entries.filter(
      (entry) => entry.status === "Draft" && entry.projectType === "Standard"
    );
    const warnings: string[] = [];

    if (mode === "DCAA") {
      if (entries.some((entry) => entry.status === "Pending Employee Review")) {
        throw new TimesheetRefusal(TIMESHEET_REVIEW_PENDING);
      }

      const check = settings?.timesheetTimecardCheck ?? "Warn";
      if (settings?.timeCardEnabled && check !== "Off") {
        const timezone = await getCompanyTimeZone(trx, companyId);
        const { rows } = await sql<{ hours: number | string | null }>`
            SELECT SUM(EXTRACT(EPOCH FROM ("clockOut" - "clockIn"))) / 3600 AS "hours"
            FROM "timeCardEntry"
            WHERE "companyId" = ${companyId}
              AND "employeeId" = ${employeeId}
              AND "clockOut" IS NOT NULL
              AND ("clockIn" AT TIME ZONE ${timezone})::date
                BETWEEN ${weekStart}::date AND ${weekEnd}::date
          `.execute(trx);
        const timecardHours = Number(rows[0]?.hours ?? 0);
        const entryHours = entries.reduce(
          (sum, entry) => sum + Number(entry.hours),
          0
        );
        if (timecardShortfall(entryHours, timecardHours) > 0) {
          const message = timecardShortfallMessage(entryHours, timecardHours);
          if (check === "Block") throw new TimesheetRefusal(message);
          warnings.push(message);
        }
      }

      if (drafts.length > 0) {
        const flsaStatus = job?.flsaStatus ?? null;
        const text = certificationTextFor(flsaStatus, settings);
        if (!text) throw new TimesheetRefusal(TIMESHEET_CERTIFICATION_MISSING);
        if (input.certificationText !== text) {
          throw new TimesheetRefusal(TIMESHEET_CERTIFICATION_CHANGED);
        }
        await trx
          .insertInto("timesheetCertification")
          .values({
            companyId,
            employeeId,
            weekStart,
            textHash: certificationTextHash(text),
            flsaStatus
          })
          .execute();
      }
    }

    if (drafts.length === 0) return { entryIds: [], warnings };

    const now = datetime.timestamp();
    const submitted = await trx
      .updateTable("timesheetEntry")
      .set({
        status: "Submitted",
        submittedAt: now,
        updatedBy: userId,
        updatedAt: now
      })
      .where("companyId", "=", companyId)
      .where(
        "id",
        "in",
        drafts.map((entry) => entry.id)
      )
      .where("status", "=", "Draft")
      .returning("id")
      .execute();
    return { entryIds: submitted.map((row) => row.id), warnings };
  });
}

// ---------------------------------------------------------------------------
// save-timesheet-entry
//
// Saves one timesheet cell, or adds one entry (Log time, service time): the
// one write path of a timesheet entry for the ERP and the MES, so the DCAA
// timekeeping controls live in one place. Standard mode keeps the Phase 1a
// behavior exactly. DCAA mode adds the entry window, the late reason, charge
// restrictions, supervisor entry on a recorded absence, Pending Employee
// Review and the correction trail.
// Spec: .ai/specs/implemented/2026-10-09-government-contracting.md (Timekeeping).

export const TIMESHEET_FUTURE_DATE = "Time cannot be entered for a future date";
export const TIMESHEET_LATE_REASON_REQUIRED =
  "Give a reason for the late entry";
export const TIMESHEET_CHANGE_REASON_REQUIRED = "Give a reason for the change";
export const TIMESHEET_SUPERVISOR_ENTRY_REFUSED =
  "You can enter time for another employee only on a day of recorded absence";
export const TIMESHEET_HOURS_REQUIRED = "Hours must be greater than 0";

type EntryRow = Pick<
  Selectable<DB["timesheetEntry"]>,
  | "id"
  | "status"
  | "hours"
  | "projectElementId"
  | "laborCategoryId"
  | "entryDate"
  | "workLocationId"
  | "rdActivityRole"
>;

/**
 * The note of an updated entry. A save without a note keeps the stored note
 * (the grid sends hours only, and Log time may have written one), as Phase 1a
 * did. A note that is sent replaces it.
 */
function keptNote(note: string | undefined): { note?: string | null } {
  return note === undefined ? {} : { note: note || null };
}

/** The fields a revision records, before and after a change. */
function revisionFields(entry: {
  hours: number | string;
  projectElementId: string | null;
  laborCategoryId: string;
  entryDate: string;
  workLocationId: string | null;
  rdActivityRole: RdActivityRole | null;
}) {
  return {
    hours: Number(entry.hours),
    projectElementId: entry.projectElementId,
    laborCategoryId: entry.laborCategoryId,
    entryDate: entry.entryDate,
    workLocationId: entry.workLocationId,
    rdActivityRole: entry.rdActivityRole
  };
}

/**
 * The entry a cell edits: a Draft first, then Rejected, Pending Employee
 * Review, Submitted and Approved. A Posted entry only when no other exists,
 * so the refusal can name it (a posted entry changes only by correction).
 */
function currentEntry(rows: EntryRow[]): EntryRow | null {
  const order: TimesheetEntryStatus[] = [
    "Draft",
    "Rejected",
    "Pending Employee Review",
    "Submitted",
    "Approved",
    "Posted"
  ];
  for (const status of order) {
    const row = rows.find((candidate) => candidate.status === status);
    if (row) return row;
  }
  return null;
}

export const saveTimesheetEntryPermission = {
  update: "projects"
} satisfies PermissionRule<z.output<typeof saveTimesheetEntryInput>>;

/**
 * Saves one cell of an employee's timesheet (employee, date, charge number,
 * labor category), or adds one entry in `add` mode. Saving never posts.
 *
 * - **`add` mode** (Log time, service time): always inserts a new entry with
 *   the requested status and visit, beside any entry of the same cell. DCAA
 *   mode applies the same controls as a cell save to it.
 * - **Standard mode** (Phase 1a): a new cell inserts a Draft; a Draft or
 *   Rejected entry is updated to Draft, or deleted at 0 hours; a Submitted,
 *   Approved or Posted entry is refused. No revision.
 * - **DCAA mode**: no future dates (except on a leave element); a date
 *   outside the entry window needs a late reason; a project that restricts
 *   charging takes time only from its members; another user may create an
 *   entry only on the employee's recorded absence; every change to a saved
 *   entry needs a reason and writes one `timesheetEntryRevision` row in the
 *   same transaction. A change by anyone but the owner gives Pending Employee
 *   Review; the owner's change returns the entry to Draft.
 */
export async function saveTimesheetEntry(
  ctx: ServiceContext,
  raw: z.input<typeof saveTimesheetEntryInput>
): Promise<SaveTimesheetEntryResult> {
  const input = saveTimesheetEntryInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  return db.transaction().execute(async (trx) =>
    save(trx, {
      ...input,
      companyId,
      userId,
      ...(await resolveRdDefaults(trx, { ...input, companyId }))
    })
  );
}

type SaveInput = Omit<
  z.output<typeof saveTimesheetEntryInput>,
  "workLocationId" | "rdActivityRole"
> & {
  companyId: string;
  userId: string;
  /** Resolved: the input's value, else the default (`resolveRdDefaults`). */
  workLocationId: string | null;
  rdActivityRole: RdActivityRole | null;
};

type Settings =
  | Pick<
      Selectable<DB["companySettings"]>,
      "timekeepingControls" | "timesheetEntryWindowDays"
    >
  | undefined;

/**
 * The work location and research role of the entry (R&D tax). A value the
 * input leaves out takes its default: the employee's job location, and the
 * labor category's role. Both are part of the cell's key, so two entries on
 * one day may differ only by location or role.
 */
async function resolveRdDefaults(
  trx: Transaction<DB>,
  input: z.output<typeof saveTimesheetEntryInput> & { companyId: string }
): Promise<{
  workLocationId: string | null;
  rdActivityRole: RdActivityRole | null;
}> {
  const [job, category] = await inOrder([
    () =>
      input.workLocationId === undefined
        ? trx
            .selectFrom("employeeJob")
            .select("locationId")
            .where("id", "=", input.employeeId)
            .where("companyId", "=", input.companyId)
            .executeTakeFirst()
        : Promise.resolve(null),
    () =>
      input.rdActivityRole === undefined
        ? trx
            .selectFrom("laborCategory")
            .select("rdActivityRole")
            .where("id", "=", input.laborCategoryId)
            .where("companyId", "=", input.companyId)
            .executeTakeFirst()
        : Promise.resolve(null)
  ]);
  return {
    workLocationId:
      input.workLocationId === undefined
        ? (job?.locationId ?? null)
        : input.workLocationId,
    rdActivityRole:
      input.rdActivityRole === undefined
        ? (category?.rdActivityRole ?? null)
        : input.rdActivityRole
  };
}

async function save(
  trx: Transaction<DB>,
  input: SaveInput
): Promise<SaveTimesheetEntryResult> {
  const { companyId, userId, employeeId } = input;
  const actorIsOwner = userId === employeeId;

  const settings = await trx
    .selectFrom("companySettings")
    .select(["timekeepingControls", "timesheetEntryWindowDays"])
    .where("id", "=", companyId)
    .executeTakeFirst();
  const mode = settings?.timekeepingControls ?? "Standard";

  if (input.mode === "add") {
    await assertProjectTakesTime(trx, input);
    return addEntry(trx, input, settings, actorIsOwner);
  }

  let existingQuery = trx
    .selectFrom("timesheetEntry")
    .select([
      "id",
      "status",
      "hours",
      "projectElementId",
      "laborCategoryId",
      "entryDate",
      "workLocationId",
      "rdActivityRole"
    ])
    .where("companyId", "=", companyId)
    .where("employeeId", "=", employeeId)
    .where("entryDate", "=", input.entryDate)
    .where("projectId", "=", input.projectId)
    .where("laborCategoryId", "=", input.laborCategoryId)
    .where("reversalOfId", "is", null);
  existingQuery = input.projectElementId
    ? existingQuery.where("projectElementId", "=", input.projectElementId)
    : existingQuery.where("projectElementId", "is", null);
  existingQuery = input.workLocationId
    ? existingQuery.where("workLocationId", "=", input.workLocationId)
    : existingQuery.where("workLocationId", "is", null);
  existingQuery = input.rdActivityRole
    ? existingQuery.where("rdActivityRole", "=", input.rdActivityRole)
    : existingQuery.where("rdActivityRole", "is", null);
  const rows = await existingQuery.orderBy("id").forUpdate().execute();
  const current = currentEntry(rows);
  // Fewer hours on a held project is a correction; more is a new charge.
  if (input.hours > Number(current?.hours ?? 0)) {
    await assertProjectTakesTime(trx, input);
  }

  if (mode === "Standard") {
    return saveStandard(trx, input, rows, actorIsOwner);
  }

  const next = nextEntryStatus({
    mode,
    current: current?.status ?? null,
    actorIsOwner
  });
  if (typeof next !== "string") throw new TimesheetRefusal(next.refuse);

  // Nothing to save, nothing to change.
  if (!current && input.hours === 0) return { entryId: null, status: null };

  const { late, lateReason } = await checkDcaaEntry(trx, input, settings);

  const reason = input.reason?.trim() || null;
  const now = datetime.timestamp();

  // 4. A new entry.
  if (!current) {
    if (!actorIsOwner) await assertSupervisorEntry(trx, input, reason);
    const created = await trx
      .insertInto("timesheetEntry")
      .values({
        companyId,
        employeeId,
        entryDate: input.entryDate,
        projectId: input.projectId,
        projectElementId: input.projectElementId,
        laborCategoryId: input.laborCategoryId,
        workLocationId: input.workLocationId,
        rdActivityRole: input.rdActivityRole,
        hours: input.hours,
        note: input.note ?? null,
        lateReason: late ? lateReason : null,
        status: next,
        createdBy: userId,
        createdAt: now
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    // 5. The owner's first save is not a change: no revision.
    if (!actorIsOwner) {
      await writeRevision(trx, {
        companyId,
        employeeId,
        timesheetEntryId: created.id,
        revisedBy: userId,
        reason: reason!,
        before: null,
        after: revisionFields(input)
      });
    }
    return { entryId: created.id, status: next };
  }

  // 5. A change to a saved entry.
  if (!reason) throw new TimesheetRefusal(TIMESHEET_CHANGE_REASON_REQUIRED);
  const before = revisionFields(current);

  // 7. Zero hours deletes the entry; the revision is written first.
  if (input.hours === 0) {
    await writeRevision(trx, {
      companyId,
      employeeId,
      timesheetEntryId: current.id,
      revisedBy: userId,
      reason,
      before,
      after: null
    });
    await trx
      .deleteFrom("timesheetEntry")
      .where("id", "=", current.id)
      .where("companyId", "=", companyId)
      .execute();
    return { entryId: null, status: null };
  }

  await trx
    .updateTable("timesheetEntry")
    .set({
      hours: input.hours,
      ...keptNote(input.note),
      ...(late ? { lateReason } : {}),
      status: next,
      // A changed entry needs approval again.
      submittedAt: null,
      approvedBy: null,
      approvedAt: null,
      rejectionNote: null,
      updatedBy: userId,
      updatedAt: now
    })
    .where("id", "=", current.id)
    .where("companyId", "=", companyId)
    .execute();
  // 6. The correction trail, in the same transaction.
  await writeRevision(trx, {
    companyId,
    employeeId,
    timesheetEntryId: current.id,
    revisedBy: userId,
    reason,
    before,
    after: revisionFields({ ...current, hours: input.hours })
  });
  return { entryId: current.id, status: next };
}

/**
 * A project On Hold takes no new hours (`heldProjectRefusal`): the
 * charge-number picker hides it, and this stops the rows already on a
 * timesheet. A stop-work order sets the project On Hold (FAR 52.242-15).
 */
async function assertProjectTakesTime(trx: Transaction<DB>, input: SaveInput) {
  const project = await trx
    .selectFrom("project")
    .select(["identifier", "name", "status", "stopWorkDate"])
    .where("id", "=", input.projectId)
    .where("companyId", "=", input.companyId)
    .executeTakeFirst();
  if (!project) throw new NotFoundError("The project does not exist");
  const refusal = heldProjectRefusal(project, input.entryDate);
  if (refusal) throw new TimesheetRefusal(refusal);
}

/**
 * DCAA steps 1–3, the controls a new entry and a change share: the entry
 * window (no future dates except on a leave element), the late reason, and
 * charge restrictions. Returns whether the date is late, with the reason.
 */
async function checkDcaaEntry(
  trx: Transaction<DB>,
  input: SaveInput,
  settings: Settings
): Promise<{ late: boolean; lateReason: string | null }> {
  const { companyId, employeeId } = input;
  const [project, element, timezone] = await inOrder([
    () =>
      trx
        .selectFrom("project")
        .select(["identifier", "name", "restrictCharging"])
        .where("id", "=", input.projectId)
        .where("companyId", "=", companyId)
        .executeTakeFirst(),
    () =>
      input.projectElementId
        ? trx
            .selectFrom("projectElement")
            .select(["isLeave"])
            .where("id", "=", input.projectElementId)
            .where("projectId", "=", input.projectId)
            .where("companyId", "=", companyId)
            .executeTakeFirst()
        : Promise.resolve(null),
    () => getCompanyTimeZone(trx, companyId)
  ]);
  if (!project) throw new NotFoundError("The project does not exist");
  if (input.projectElementId && !element) {
    throw new NotFoundError("The element does not exist");
  }

  // 1–2. The entry window.
  const entryWindow = isEntryDateAllowed({
    entryDate: input.entryDate,
    today: datetime.today(timezone).toString(),
    windowDays: settings?.timesheetEntryWindowDays ?? 1,
    isLeave: element?.isLeave ?? false
  });
  if (!entryWindow.allowed) throw new TimesheetRefusal(TIMESHEET_FUTURE_DATE);
  const lateReason = input.lateReason?.trim() || null;
  if (entryWindow.late && !lateReason) {
    throw new TimesheetRefusal(TIMESHEET_LATE_REASON_REQUIRED);
  }

  // 3. Charge restrictions.
  if (project.restrictCharging) {
    const member = await trx
      .selectFrom("projectMember")
      .select("userId")
      .where("projectId", "=", input.projectId)
      .where("userId", "=", employeeId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!member) {
      throw new TimesheetRefusal(
        `${project.identifier || project.name} accepts time only from its members`
      );
    }
  }

  return { late: entryWindow.late, lateReason };
}

/**
 * `add` mode: one new entry each call, as Phase 1a Log time and service time
 * did. It never replaces the hours of an entry already in the cell.
 * - Standard mode: the owner adds the entry with the requested status.
 * - DCAA mode: the cell's controls apply (entry window, late reason, charge
 *   restrictions). The owner's entry is Draft whatever status was asked for,
 *   so it goes through the weekly certification and approval; it is not a
 *   change, so it writes no revision. Another user adds an entry only on the
 *   employee's recorded absence, with a reason; it is Pending Employee
 *   Review and writes a revision.
 */
async function addEntry(
  trx: Transaction<DB>,
  input: SaveInput,
  settings: Settings,
  actorIsOwner: boolean
): Promise<SaveTimesheetEntryResult> {
  const { companyId, userId, employeeId } = input;
  const mode = settings?.timekeepingControls ?? "Standard";
  if (input.hours <= 0) throw new TimesheetRefusal(TIMESHEET_HOURS_REQUIRED);

  let status: TimesheetEntryStatus = input.status ?? "Draft";
  let late = false;
  let lateReason: string | null = null;
  const reason = input.reason?.trim() || null;

  if (mode === "Standard") {
    // Standard mode has no supervisor entry: the owner logs their own time.
    if (!actorIsOwner) throw new TimesheetRefusal(TIMESHEET_REFUSAL_NOT_DRAFT);
  } else {
    ({ late, lateReason } = await checkDcaaEntry(trx, input, settings));
    if (!actorIsOwner) {
      await assertSupervisorEntry(trx, input, reason);
      status = "Pending Employee Review";
    } else {
      // An added entry waits for the weekly certification and approval
      // (`submit-timesheet-week`), as a cell save does. Log time asks for
      // Submitted; DCAA mode never submits one entry on its own.
      status = "Draft";
    }
  }

  const now = datetime.timestamp();
  const created = await trx
    .insertInto("timesheetEntry")
    .values({
      companyId,
      employeeId,
      entryDate: input.entryDate,
      projectId: input.projectId,
      projectElementId: input.projectElementId,
      serviceVisitId: input.serviceVisitId ?? null,
      laborCategoryId: input.laborCategoryId,
      workLocationId: input.workLocationId,
      rdActivityRole: input.rdActivityRole,
      hours: input.hours,
      note: input.note ?? null,
      lateReason: late ? lateReason : null,
      status,
      submittedAt: status === "Submitted" ? now : null,
      createdBy: userId,
      createdAt: now
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  if (mode === "DCAA" && !actorIsOwner) {
    await writeRevision(trx, {
      companyId,
      employeeId,
      timesheetEntryId: created.id,
      revisedBy: userId,
      reason: reason!,
      before: null,
      after: revisionFields(input)
    });
  }
  return { entryId: created.id, status };
}

/**
 * DCAA supervisor entry: another user creates an entry for the employee only
 * on a day of recorded absence, and only with a reason.
 */
async function assertSupervisorEntry(
  trx: Transaction<DB>,
  input: SaveInput,
  reason: string | null
): Promise<void> {
  const absence = await trx
    .selectFrom("peopleAbsence")
    .select("id")
    .where("companyId", "=", input.companyId)
    .where("employeeId", "=", input.employeeId)
    .where("date", "=", input.entryDate)
    .executeTakeFirst();
  if (!absence) throw new TimesheetRefusal(TIMESHEET_SUPERVISOR_ENTRY_REFUSED);
  if (!reason) throw new TimesheetRefusal(TIMESHEET_CHANGE_REASON_REQUIRED);
}

/** Phase 1a `upsertTimesheetCell`, unchanged. */
async function saveStandard(
  trx: Transaction<DB>,
  input: SaveInput,
  rows: EntryRow[],
  actorIsOwner: boolean
): Promise<SaveTimesheetEntryResult> {
  const { companyId, userId } = input;
  const editable =
    rows.find((row) => row.status === "Draft") ??
    rows.find((row) => row.status === "Rejected");

  // Standard mode has no supervisor entry: the owner edits their own time.
  if (!actorIsOwner) throw new TimesheetRefusal(TIMESHEET_REFUSAL_NOT_DRAFT);

  if (!editable) {
    if (rows.some((row) => row.status === "Posted")) {
      throw new TimesheetRefusal(
        "This time is posted. Use a correction to change posted hours."
      );
    }
    if (rows.length > 0) {
      throw new TimesheetRefusal(
        "This time is submitted. It can change only after it is rejected."
      );
    }
    if (input.hours === 0) return { entryId: null, status: null };
    const created = await trx
      .insertInto("timesheetEntry")
      .values({
        companyId,
        employeeId: input.employeeId,
        entryDate: input.entryDate,
        projectId: input.projectId,
        projectElementId: input.projectElementId,
        laborCategoryId: input.laborCategoryId,
        workLocationId: input.workLocationId,
        rdActivityRole: input.rdActivityRole,
        hours: input.hours,
        note: input.note ?? null,
        status: "Draft",
        createdBy: userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { entryId: created.id, status: "Draft" };
  }

  if (input.hours === 0) {
    await trx
      .deleteFrom("timesheetEntry")
      .where("id", "=", editable.id)
      .where("companyId", "=", companyId)
      .where("status", "in", ["Draft", "Rejected"])
      .execute();
    return { entryId: null, status: null };
  }

  await trx
    .updateTable("timesheetEntry")
    .set({
      hours: input.hours,
      ...keptNote(input.note),
      status: "Draft",
      rejectionNote: null,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .where("id", "=", editable.id)
    .where("companyId", "=", companyId)
    .where("status", "in", ["Draft", "Rejected"])
    .execute();
  return { entryId: editable.id, status: "Draft" };
}

async function writeRevision(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    employeeId: string;
    timesheetEntryId: string;
    revisedBy: string;
    reason: string;
    before: ReturnType<typeof revisionFields> | null;
    after: ReturnType<typeof revisionFields> | null;
  }
): Promise<void> {
  await trx
    .insertInto("timesheetEntryRevision")
    .values({
      companyId: args.companyId,
      timesheetEntryId: args.timesheetEntryId,
      employeeId: args.employeeId,
      revisedBy: args.revisedBy,
      reason: args.reason,
      before: toJson(args.before) ?? null,
      after: toJson(args.after) ?? null
    })
    .execute();
}

// ---------------------------------------------------------------------------
// post-timesheet

export const postTimesheetPermission = {
  update: "projects"
} satisfies PermissionRule<z.output<typeof postTimesheetInput>>;

/**
 * Posts Submitted or Approved timesheet entries: the cost (hours × the labor
 * category's rate, or the original's rate for a reversal) goes Dr the project
 * account / Cr laborAbsorptionAccount, one projectLedger row per entry, and
 * each entry is stamped Posted. The journal is Provisional before the
 * company's accounting cutover and Posted after it. A Statistical project
 * writes no journal and no ledger row. Entries that are not postable (Draft, Rejected, already posted)
 * are skipped. The ERP checks who may post (approval routing) before it calls.
 *
 * A Service project's entry also posts from Draft (service time posts at Stop
 * work, with no submit or approval). Its coverage decides the account: a
 * stored coverage with a reason is the user's override, a reversal takes its
 * original's, and any other entry gets `resolveCoverage`, stored on the entry.
 * It writes a billable item; a reversal reverses its original's.
 */
export async function postTimesheet(
  ctx: ServiceContext,
  raw: z.input<typeof postTimesheetInput>
): Promise<PostTimesheetResult> {
  const { timesheetEntryIds } = postTimesheetInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const entryIds = [...new Set(timesheetEntryIds)];

  const settings = await single(
    db,
    "companySettings",
    { id: companyId },
    {
      columns: ["timekeepingControls", "standardWeeklyHours"]
    }
  );
  const isDcaa = settings.data?.timekeepingControls === "DCAA";
  const standardWeeklyHours = Number(settings.data?.standardWeeklyHours ?? 40);

  return db.transaction().execute(async (trx) => {
    // Row locks: two posts of one entry must not both post it.
    const locked = await trx
      .selectFrom("timesheetEntry")
      .select([
        "id",
        "employeeId",
        "entryDate",
        "projectId",
        "projectElementId",
        "laborCategoryId",
        "hours",
        "status",
        "postedAt",
        "reversalOfId",
        "note",
        "coverage",
        "coverageReason",
        (eb) =>
          eb
            .selectFrom("project")
            .select("project.projectType")
            .whereRef("project.id", "=", "timesheetEntry.projectId")
            .whereRef("project.companyId", "=", "timesheetEntry.companyId")
            .as("projectType")
      ])
      .where("id", "in", entryIds)
      .where("companyId", "=", companyId)
      .orderBy("id")
      .forUpdate()
      .execute();

    const entries = locked
      .filter(
        (entry) =>
          (entry.status === "Submitted" ||
            entry.status === "Approved" ||
            (entry.status === "Draft" && entry.projectType === "Service")) &&
          entry.postedAt === null
      )
      .map((entry) => ({
        id: entry.id,
        employeeId: entry.employeeId,
        entryDate: entry.entryDate,
        projectId: entry.projectId,
        projectElementId: entry.projectElementId,
        laborCategoryId: entry.laborCategoryId,
        hours: Number(entry.hours),
        reversalOfId: entry.reversalOfId,
        isService: entry.projectType === "Service",
        note: entry.note,
        coverage: entry.coverage as ServiceCoverage | null,
        coverageReason: entry.coverageReason,
        customerId: null as string | null
      }));
    if (entries.length === 0) {
      return { success: true, postedEntryIds: [], journalIds: [] };
    }

    const categoryIds = [...new Set(entries.map((e) => e.laborCategoryId))];
    const originalIds = [
      ...new Set(
        entries
          .map((e) => e.reversalOfId)
          .filter((id): id is string => Boolean(id))
      )
    ];

    // DCAA mode: dilute each exempt employee's week (CAM 6-410.4a).
    const dilution = isDcaa
      ? await loadWeekDilution(trx, {
          companyId,
          standardWeeklyHours,
          entries
        })
      : null;
    const redilutedEntries = dilution?.posted ?? [];

    const serviceEntries = entries.filter((e) => e.isService);
    const serviceRefs = [
      ...serviceEntries,
      ...redilutedEntries.filter((e) => e.isService)
    ].map((e) => ({
      projectId: e.projectId,
      projectElementId: e.projectElementId
    }));
    const [
      contexts,
      rates,
      originals,
      originalLedger,
      accountDefaults,
      services
    ] = await inOrder([
      () =>
        loadProjectPostingContexts(
          trx,
          companyId,
          [...entries, ...redilutedEntries].map((e) => ({
            projectId: e.projectId,
            projectElementId: e.projectElementId
          }))
        ),
      () =>
        trx
          .selectFrom("laborCategoryRate")
          .select(["laborCategoryId", "effectiveFrom", "costRate"])
          .where("laborCategoryId", "in", categoryIds)
          .where("companyId", "=", companyId)
          .execute(),
      async () =>
        originalIds.length === 0
          ? ([] as Pick<
              Selectable<DB["timesheetEntry"]>,
              "id" | "costRate" | "coverage" | "coverageReason"
            >[])
          : trx
              .selectFrom("timesheetEntry")
              .select(["id", "costRate", "coverage", "coverageReason"])
              .where("id", "in", originalIds)
              .where("companyId", "=", companyId)
              .execute(),
      async () =>
        originalIds.length === 0
          ? ([] as Pick<Selectable<DB["projectLedger"]>, "id" | "documentId">[])
          : trx
              .selectFrom("projectLedger")
              .select(["id", "documentId"])
              .where("documentType", "=", "Timesheet")
              .where("documentId", "in", originalIds)
              .where("reversalOfId", "is", null)
              // Not reversed by a later row: a coverage reclass reverses
              // a service row and writes its replacement.
              .where(({ not, exists, selectFrom }) =>
                not(
                  exists(
                    selectFrom("projectLedger as reversal")
                      .select("reversal.id")
                      .whereRef(
                        "reversal.reversalOfId",
                        "=",
                        "projectLedger.id"
                      )
                      .whereRef(
                        "reversal.companyId",
                        "=",
                        "projectLedger.companyId"
                      )
                  )
                )
              )
              .where("companyId", "=", companyId)
              .execute(),
      () =>
        trx
          .selectFrom("accountDefault")
          .select(["laborAbsorptionAccount", "retainedEarningsAccount"])
          .where("companyId", "=", companyId)
          .executeTakeFirst(),
      () => loadServicePostingContexts(trx, companyId, serviceRefs)
    ]);
    if (!accountDefaults) throw new Error("Error getting account defaults");
    // Every posting writes its journal: Provisional before the company's
    // accounting cutover, Posted after it. FOR SHARE holds the status until
    // commit. A Provisional journal has no accounting period.
    const postingStatus = await journalPostingStatus(trx, companyId);
    const journalOptions = { postingStatus, accountDefaults };

    // A re-diluted Service entry keeps its order's Customer dimension.
    for (const entry of redilutedEntries) {
      if (!entry.isService) continue;
      entry.customerId =
        services.get(projectPostingKey(entry.projectId, entry.projectElementId))
          ?.customerId ?? null;
    }

    // A Service entry's coverage: a reversal posts to its original's
    // account, a stored coverage with a reason is the user's override, and
    // any other entry gets the coverage its date and the asset decide.
    const originalCoverage = new Map(
      originals.map((original) => [original.id, original])
    );
    for (const entry of serviceEntries) {
      const service = services.get(
        projectPostingKey(entry.projectId, entry.projectElementId)
      );
      if (!service) {
        throw new ProjectChargeError(
          "No service order owns the project of this timesheet entry"
        );
      }
      entry.customerId = service.customerId;
      const original = entry.reversalOfId
        ? originalCoverage.get(entry.reversalOfId)
        : undefined;
      if (original) {
        entry.coverage = original.coverage as ServiceCoverage | null;
        entry.coverageReason = original.coverageReason;
      } else if (!(entry.coverage && entry.coverageReason)) {
        entry.coverage = serviceChargeCoverage(
          service,
          "Time",
          entry.entryDate
        );
        entry.coverageReason = null;
      }
    }

    const ledgerRowByEntry = new Map(
      originalLedger.map((row) => [row.documentId, row.id])
    );
    const originalById = new Map<string, TimesheetOriginal>(
      originals.map((original) => [
        original.id,
        {
          id: original.id,
          costRate:
            original.costRate === null ? null : Number(original.costRate),
          ledgerRowId: ledgerRowByEntry.get(original.id) ?? null
        }
      ])
    );

    const plan = planTimesheetPosting(
      entries,
      contexts,
      rates.map((rate) => ({
        laborCategoryId: rate.laborCategoryId,
        effectiveFrom: rate.effectiveFrom,
        costRate: Number(rate.costRate)
      })),
      originalById,
      {
        ...journalOptions,
        dilutionFactors: dilution?.factorByEntry,
        restrictCharging: isDcaa
      }
    );

    // Re-dilution: the week's posted entries post the difference to their
    // new diluted cost, as ledger rows with quantity 0 and journal lines of
    // their own account.
    if (dilution && dilution.adjustments.length > 0) {
      const redilutedById = new Map(
        redilutedEntries.map((entry) => [entry.id, entry])
      );
      const redilution = planRedilutionPostings(
        dilution.adjustments.map((adjustment) => ({
          entry: redilutedById.get(adjustment.entryId)!,
          amount: adjustment.amount
        })),
        contexts,
        journalOptions
      );
      plan.lines.push(...redilution.lines);
      plan.ledgerRows.push(...redilution.ledgerRows);
    }

    // Journals: one per accounting period the entries fall in, dated the
    // period's latest entry date. Before the cutover there is no period,
    // so one Provisional journal holds every line.
    const journalIdByEntry = new Map<string, string>();
    const debitLineIdByEntry = new Map<string, string>();
    const journalIds: string[] = [];

    if (plan.lines.length > 0) {
      const periodByDate = new Map<string, string | null>();
      for (const date of [
        ...new Set(plan.lines.map((l) => l.postingDate))
      ].sort()) {
        const period =
          postingStatus === "Posted"
            ? await resolveAccountingPeriod(trx, companyId, date, "current")
            : null;
        periodByDate.set(date, period?.id ?? null);
      }

      const linesByPeriod = new Map<string | null, TimesheetJournalLine[]>();
      for (const line of plan.lines) {
        const periodId = periodByDate.get(line.postingDate) ?? null;
        const group = linesByPeriod.get(periodId) ?? [];
        group.push(line);
        linesByPeriod.set(periodId, group);
      }

      const dimensions = await trx
        .selectFrom("dimension")
        .innerJoin(
          "company",
          "company.companyGroupId",
          "dimension.companyGroupId"
        )
        .select(["dimension.id", "dimension.entityType"])
        .where("company.id", "=", companyId)
        .where("dimension.active", "=", true)
        .where("dimension.entityType", "in", [
          "Project",
          "ProjectElement",
          "Employee",
          "Customer"
        ])
        .execute();
      const dimensionIdByType = new Map(
        dimensions
          .filter((d) => d.entityType)
          .map((d) => [d.entityType as string, d.id])
      );

      for (const [accountingPeriodId, lines] of linesByPeriod) {
        const postingDate = lines.reduce(
          (latest, line) =>
            line.postingDate > latest ? line.postingDate : latest,
          lines[0]!.postingDate
        );
        const journalId = await createAdjustmentJournal(trx, {
          companyId,
          accountingPeriodId,
          status: postingStatus,
          description: "Project Timesheet",
          postingDate,
          userId,
          sourceType: "Timesheet"
        });
        journalIds.push(journalId);

        const lineIds = await allocateJournalLineIds(trx, lines.length);
        const journalLineReference = nanoid();
        await trx
          .insertInto("journalLine")
          .values(
            lines.map((line, index) => ({
              id: lineIds[index]!,
              journalId,
              accountId: line.accountId,
              accountDefaultRole: line.accountDefaultRole,
              description: line.description,
              amount: line.amount,
              quantity: 1,
              documentType: "Timesheet" as const,
              documentId: line.entryId,
              documentLineReference: journalReference.to.timesheet(
                line.entryId
              ),
              journalLineReference,
              companyId
            }))
          )
          .execute();

        const dimensionRows = lines.flatMap((line, index) =>
          (
            [
              ["Project", line.projectId],
              ["ProjectElement", line.projectElementId],
              ["Employee", line.employeeId],
              ["Customer", line.customerId]
            ] as const
          ).flatMap(([entityType, valueId]) => {
            const dimensionId = dimensionIdByType.get(entityType);
            return dimensionId && valueId
              ? [
                  {
                    journalLineId: lineIds[index]!,
                    dimensionId,
                    valueId,
                    companyId
                  }
                ]
              : [];
          })
        );
        if (dimensionRows.length > 0) {
          await trx
            .insertInto("journalLineDimension")
            .values(dimensionRows)
            .execute();
        }

        lines.forEach((line, index) => {
          journalIdByEntry.set(line.entryId, journalId);
          if (line.isProjectDebit) {
            debitLineIdByEntry.set(line.entryId, lineIds[index]!);
          }
        });
      }
    }

    if (plan.ledgerRows.length > 0) {
      const insertedLedger = await insertProjectLedgerRows(trx, {
        companyId,
        userId,
        rows: plan.ledgerRows.map((row) =>
          buildProjectLedgerRow({
            companyId,
            projectId: row.projectId,
            projectElementId: row.projectElementId,
            postingDate: row.postingDate,
            costType: "Labor",
            documentType: "Timesheet",
            documentId: row.entryId,
            employeeId: row.employeeId,
            laborCategoryId: row.laborCategoryId,
            quantity: row.quantity,
            unitOfMeasureCode: "HR",
            amount: row.amount,
            journalLineId: debitLineIdByEntry.get(row.entryId) ?? null,
            reversalOfId: row.reversalOfId,
            coverage: row.coverage,
            coverageReason: row.coverageReason,
            unallowable: row.unallowable,
            createdBy: userId
          })
        )
      });

      await writeServiceBillableItems(trx, {
        companyId,
        userId,
        entries: serviceEntries,
        ledgerRows: plan.ledgerRows,
        ledgerIdByEntry: new Map(
          insertedLedger.map((row) => [row.documentId, row.id])
        ),
        services
      });

      // A Capitalize entry also builds its asset.
      await writeProjectCipRows(trx, {
        companyId,
        userId,
        rows: plan.ledgerRows.map((row) =>
          buildProjectCipRow({
            resolved: row,
            companyId,
            userId,
            projectId: row.projectId,
            projectElementId: row.projectElementId,
            sourceType: "Timesheet",
            sourceDocumentId: row.entryId,
            amount: row.amount,
            costDate: row.postingDate,
            journalId: journalIdByEntry.get(row.entryId) ?? null
          })
        )
      });
    }

    // One statement for every entry: each carries its own rate and journal,
    // and a Service entry its coverage.
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));
    const postedAt = datetime.timestamp();
    await sql`
        UPDATE "timesheetEntry" t
        SET "status" = 'Posted',
            "costRate" = v."costRate",
            "journalId" = v."journalId",
            "dilutionFactor" = COALESCE(v."dilutionFactor", t."dilutionFactor"),
            "coverage" = COALESCE(v."coverage"::"serviceCoverage", t."coverage"),
            "coverageReason" = CASE WHEN v."coverage" IS NULL
              THEN t."coverageReason" ELSE v."coverageReason" END,
            "postedAt" = ${postedAt}::timestamptz,
            "updatedBy" = ${userId},
            "updatedAt" = ${postedAt}::timestamptz
        FROM (VALUES ${sql.join(
          plan.stamps.map((stamp) => {
            const entry = entryById.get(stamp.entryId);
            const coverage = entry?.isService ? entry.coverage : null;
            return sql`(${stamp.entryId}, ${stamp.costRate}::numeric, ${
              journalIdByEntry.get(stamp.entryId) ?? null
            }::text, ${stamp.dilutionFactor ?? null}::numeric, ${coverage}::text, ${
              coverage ? (entry?.coverageReason ?? null) : null
            }::text)`;
          })
        )}) AS v("id", "costRate", "journalId", "dilutionFactor", "coverage", "coverageReason")
        WHERE t."id" = v."id" AND t."companyId" = ${companyId}
      `.execute(trx);

    // A re-diluted entry carries its new rate and factor, so a later
    // reversal nets exactly what it posted.
    if (dilution && dilution.stamps.length > 0) {
      await sql`
          UPDATE "timesheetEntry" t
          SET "costRate" = v."costRate",
              "dilutionFactor" = v."dilutionFactor",
              "updatedBy" = ${userId},
              "updatedAt" = ${postedAt}::timestamptz
          FROM (VALUES ${sql.join(
            dilution.stamps.map(
              (stamp) =>
                sql`(${stamp.entryId}, ${stamp.costRate}::numeric, ${stamp.dilutionFactor}::numeric)`
            )
          )}) AS v("id", "costRate", "dilutionFactor")
          WHERE t."id" = v."id" AND t."companyId" = ${companyId}
        `.execute(trx);
    }

    await startElementsOnFirstCharge(
      trx,
      companyId,
      entries.filter((e) => !e.reversalOfId).map((e) => e.projectElementId)
    );

    return {
      success: true,
      postedEntryIds: plan.stamps.map((stamp) => stamp.entryId),
      journalIds
    };
  });
}

type PostingEntry = TimesheetPostingEntry & {
  isService: boolean;
  note: string | null;
};

/**
 * The dilution of every (exempt employee, ISO week) the call touches, in DCAA
 * mode, in at most 3 queries: the employees' FLSA status, the weeks'
 * entries, and what each posted entry's ledger rows hold.
 * - The week's hours are its Submitted, Approved and Posted entries plus the
 *   entries of this call (a Service entry posts from Draft).
 * - `factorByEntry`: the factor of each new entry of the call.
 * - `posted`, `adjustments`, `stamps`: the week's other posted entries (not a
 *   reversal, not reversed) and their re-dilution (`planDilution`).
 */
async function loadWeekDilution(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    standardWeeklyHours: number;
    entries: PostingEntry[];
  }
): Promise<{
  factorByEntry: Map<string, number>;
  posted: PostingEntry[];
  adjustments: { entryId: string; amount: number }[];
  stamps: { entryId: string; costRate: number; dilutionFactor: number }[];
} | null> {
  const { companyId, entries } = args;
  const employeeIds = [...new Set(entries.map((entry) => entry.employeeId))];
  const jobs = await trx
    .selectFrom("employeeJob")
    .select(["id", "flsaStatus"])
    .where("id", "in", employeeIds)
    .where("companyId", "=", companyId)
    .execute();
  const exempt = new Set(
    jobs.filter((job) => job.flsaStatus === "Exempt").map((job) => job.id)
  );
  const diluted = entries.filter((entry) => exempt.has(entry.employeeId));
  if (diluted.length === 0) return null;

  const pairOf = (employeeId: string, entryDate: string) =>
    `${employeeId}\x1f${weekStartOf(entryDate)}`;
  const pairs = new Set(
    diluted.map((entry) => pairOf(entry.employeeId, entry.entryDate))
  );
  const weekStarts = diluted
    .map((entry) => weekStartOf(entry.entryDate))
    .sort();
  const from = weekStarts[0]!;
  const to = parseDate(weekStarts[weekStarts.length - 1]!)
    .add({ days: 6 })
    .toString();

  const rows = await trx
    .selectFrom("timesheetEntry")
    .innerJoin("project", (join) =>
      join
        .onRef("project.id", "=", "timesheetEntry.projectId")
        .onRef("project.companyId", "=", "timesheetEntry.companyId")
    )
    .select([
      "timesheetEntry.id",
      "timesheetEntry.employeeId",
      "timesheetEntry.entryDate",
      "timesheetEntry.projectId",
      "timesheetEntry.projectElementId",
      "timesheetEntry.laborCategoryId",
      "timesheetEntry.hours",
      "timesheetEntry.status",
      "timesheetEntry.costRate",
      "timesheetEntry.dilutionFactor",
      "timesheetEntry.reversalOfId",
      "timesheetEntry.note",
      "timesheetEntry.coverage",
      "timesheetEntry.coverageReason",
      "project.projectType"
    ])
    .where("timesheetEntry.companyId", "=", companyId)
    .where("timesheetEntry.employeeId", "in", [...exempt])
    .where("timesheetEntry.entryDate", ">=", from)
    .where("timesheetEntry.entryDate", "<=", to)
    .execute();

  const callIds = new Set(entries.map((entry) => entry.id));
  const reversedIds = new Set(
    [...rows, ...entries]
      .map((row) => row.reversalOfId)
      .filter((id): id is string => Boolean(id))
  );
  const hoursByPair = new Map<string, number>();
  for (const row of rows) {
    const pair = pairOf(row.employeeId, row.entryDate);
    if (!pairs.has(pair)) continue;
    const counts =
      callIds.has(row.id) ||
      row.status === "Submitted" ||
      row.status === "Approved" ||
      row.status === "Posted";
    if (!counts) continue;
    hoursByPair.set(pair, (hoursByPair.get(pair) ?? 0) + Number(row.hours));
  }
  const factorByPair = new Map(
    [...pairs].map((pair) => [
      pair,
      dilutionFactor(args.standardWeeklyHours, hoursByPair.get(pair) ?? 0)
    ])
  );
  const factorByEntry = new Map(
    diluted
      .filter((entry) => !entry.reversalOfId)
      .map((entry) => [
        entry.id,
        factorByPair.get(pairOf(entry.employeeId, entry.entryDate))!
      ])
  );

  const postedRows = rows.filter(
    (row) =>
      row.status === "Posted" &&
      !callIds.has(row.id) &&
      !row.reversalOfId &&
      !reversedIds.has(row.id) &&
      row.costRate !== null &&
      pairs.has(pairOf(row.employeeId, row.entryDate))
  );
  if (postedRows.length === 0) {
    return { factorByEntry, posted: [], adjustments: [], stamps: [] };
  }

  const amounts = await trx
    .selectFrom("projectLedger")
    .select(["documentId", (eb) => eb.fn.sum<string>("amount").as("amount")])
    .where("companyId", "=", companyId)
    .where("documentType", "=", "Timesheet")
    .where(
      "documentId",
      "in",
      postedRows.map((row) => row.id)
    )
    .groupBy("documentId")
    .execute();
  const amountByEntry = new Map(
    amounts.map((row) => [row.documentId, Number(row.amount)])
  );

  const adjustments: { entryId: string; amount: number }[] = [];
  const stamps: {
    entryId: string;
    costRate: number;
    dilutionFactor: number;
  }[] = [];
  for (const pair of pairs) {
    const inWeek: DilutionPostedEntry[] = postedRows
      .filter((row) => pairOf(row.employeeId, row.entryDate) === pair)
      .map((row) => ({
        id: row.id,
        hours: Number(row.hours),
        costRate: Number(row.costRate),
        dilutionFactor:
          row.dilutionFactor === null ? null : Number(row.dilutionFactor),
        postedAmount: amountByEntry.get(row.id) ?? 0
      }));
    if (inWeek.length === 0) continue;
    const planned = planDilution([], inWeek, factorByPair.get(pair)!);
    adjustments.push(...planned.adjustments);
    stamps.push(...planned.stamps);
  }

  return {
    factorByEntry,
    posted: postedRows.map((row) => ({
      id: row.id,
      employeeId: row.employeeId,
      entryDate: row.entryDate,
      projectId: row.projectId,
      projectElementId: row.projectElementId,
      laborCategoryId: row.laborCategoryId,
      hours: Number(row.hours),
      reversalOfId: null,
      isService: row.projectType === "Service",
      note: row.note,
      coverage: row.coverage as ServiceCoverage | null,
      coverageReason: row.coverageReason,
      customerId: null
    })),
    adjustments,
    stamps
  };
}

/**
 * The billable items of the Service entries just posted: a new item per
 * entry, priced by the service labor item, and for a reversal the reversal of
 * its original's item (written off while unbilled, else a negative copy).
 */
async function writeServiceBillableItems(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    entries: {
      id: string;
      note: string | null;
      coverage: ServiceCoverage | null;
      reversalOfId: string | null;
      projectId: string;
      projectElementId: string | null;
    }[];
    ledgerRows: TimesheetLedgerRow[];
    ledgerIdByEntry: Map<string, string>;
    services: Map<string, ServicePostingContext>;
  }
): Promise<void> {
  const { companyId, userId } = args;
  const entryById = new Map(args.entries.map((entry) => [entry.id, entry]));
  const rows = args.ledgerRows.filter((row) => entryById.has(row.entryId));
  if (rows.length === 0) return;

  // The originals' items, for the reversals: one query.
  const originalLedgerIds = rows
    .map((row) => row.reversalOfId)
    .filter((id): id is string => Boolean(id));
  const originalItems =
    originalLedgerIds.length === 0
      ? []
      : await trx
          .selectFrom("projectBillableItem")
          .selectAll()
          .where("projectLedgerId", "in", originalLedgerIds)
          .where("reversalOfId", "is", null)
          .where("companyId", "=", companyId)
          .execute();
  const itemByLedger = new Map(
    originalItems.map((item) => [item.projectLedgerId, item])
  );

  const inserts: Insertable<DB["projectBillableItem"]>[] = [];
  const writeOffIds: string[] = [];
  for (const row of rows) {
    const entry = entryById.get(row.entryId)!;
    const ledgerId = args.ledgerIdByEntry.get(row.entryId);
    if (!ledgerId) continue;

    if (row.reversalOfId) {
      const original = itemByLedger.get(row.reversalOfId);
      if (!original) continue;
      const reversal = reverseBillableItem(
        {
          ...original,
          quantity: Number(original.quantity),
          unitPrice: Number(original.unitPrice),
          amount: Number(original.amount)
        },
        { projectLedgerId: ledgerId, createdBy: userId }
      );
      if (reversal.update) writeOffIds.push(original.id);
      if (reversal.insert) inserts.push(reversal.insert);
      continue;
    }

    if (!entry.coverage) continue;
    const service = args.services.get(
      projectPostingKey(entry.projectId, entry.projectElementId)
    );
    const item = buildBillableItem({
      ledgerRow: {
        id: ledgerId,
        companyId,
        projectId: row.projectId,
        projectElementId: row.projectElementId,
        costType: "Labor",
        quantity: row.quantity,
        amount: row.amount,
        itemId: service?.laborItemId ?? null,
        createdBy: userId
      },
      coverage: entry.coverage,
      laborPrice: service?.laborPrice ?? null,
      partPrice: null,
      description: entry.note?.trim() || "Labor"
    });
    if (item) inserts.push(item);
  }

  if (writeOffIds.length > 0) {
    await trx
      .updateTable("projectBillableItem")
      .set({
        status: "Written Off",
        statusReason: "Reversed",
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "in", writeOffIds)
      .where("companyId", "=", companyId)
      .execute();
  }
  if (inserts.length > 0) {
    await trx.insertInto("projectBillableItem").values(inserts).execute();
  }
}

// ---------------------------------------------------------------------------
// post-project-expense

export const postProjectExpenseInput = z.object({
  projectExpenseEntryId: z.string()
});

export type PostProjectExpenseResult = {
  success: true;
  /** False when the entry was already posted. */
  posted: boolean;
  journalId: string | null;
  projectLedgerId: string | null;
};

export const postProjectExpensePermission = {
  update: "projects"
} satisfies PermissionRule<z.output<typeof postProjectExpenseInput>>;

/**
 * Posts a project expense entry (a cost with no invoice: mileage, a meal, a
 * part bought on a card): Dr the project account / Cr
 * goodsReceivedNotInvoicedAccount, with `sourceType 'Project Expense'` and the
 * Project, Project Element and Employee dimensions, plus one projectLedger row
 * of type Other Direct. The journal is Provisional before the company's
 * accounting cutover and Posted after it. A Statistical project charges
 * indirectCostAccount and writes no ledger row.
 *
 * On a Service project the coverage decides the account (the user's override
 * with a reason, else `resolveCoverage` for an expense), the journal carries
 * the Customer dimension, and the charge writes a billable item at its
 * amount. A reversal entry (`reversalOfId`) posts its own (negative) amount at
 * its original's coverage and reverses the original's billable item.
 * Posting twice is a no-op.
 */
export async function postProjectExpense(
  ctx: ServiceContext,
  raw: z.input<typeof postProjectExpenseInput>
): Promise<PostProjectExpenseResult> {
  const { projectExpenseEntryId } = postProjectExpenseInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;

  return db.transaction().execute(async (trx) => {
    // Row lock: two posts of one entry must not both post it.
    const entry = await trx
      .selectFrom("projectExpenseEntry")
      .selectAll()
      .where("id", "=", projectExpenseEntryId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!entry) throw new NotFoundError("Expense entry not found");

    const alreadyPosted = await trx
      .selectFrom("projectLedger")
      .select("id")
      .where("documentType", "=", "Project Expense")
      .where("documentId", "=", entry.id)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (entry.journalId || alreadyPosted) {
      return {
        success: true,
        posted: false,
        journalId: entry.journalId,
        projectLedgerId: alreadyPosted?.id ?? null
      };
    }

    const isReversal = Boolean(entry.reversalOfId);
    const contexts = await loadProjectPostingContexts(trx, companyId, [
      {
        projectId: entry.projectId,
        projectElementId: entry.projectElementId
      }
    ]);
    const context = contexts.get(
      projectPostingKey(entry.projectId, entry.projectElementId)
    );
    if (!context) throw new NotFoundError("Project element not found");
    assertChargeable(context, isReversal ? "commitment" : "new");

    // The original's open ledger row: not reversed by a later row (a
    // coverage reclass reverses and replaces it).
    const original = entry.reversalOfId
      ? await sql<{
          id: string;
          coverage: ServiceCoverage | null;
          coverageReason: string | null;
        }>`
            SELECT pl."id", pl."coverage", pl."coverageReason"
            FROM "projectLedger" pl
            WHERE pl."documentType" = 'Project Expense'
              AND pl."documentId" = ${entry.reversalOfId}
              AND pl."companyId" = ${companyId}
              AND pl."reversalOfId" IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM "projectLedger" r
                WHERE r."reversalOfId" = pl."id" AND r."companyId" = pl."companyId"
              )
            ORDER BY pl."createdAt" DESC, pl."id" DESC
            LIMIT 1
          `
          .execute(trx)
          .then((result) => result.rows[0] ?? null)
      : null;

    const isService = context.project.costTreatment === "By Coverage";
    const service = isService
      ? await loadServicePostingContext(trx, {
          companyId,
          projectId: entry.projectId,
          elementId: entry.projectElementId
        })
      : null;
    if (isService && !service) {
      throw new ProjectChargeError(
        "No service order owns the project of this expense"
      );
    }

    let coverage: ServiceCoverage | null = null;
    let coverageReason: string | null = null;
    if (service) {
      if (original) {
        coverage = original.coverage;
        coverageReason = original.coverageReason;
      } else if (entry.coverage && entry.coverageReason) {
        coverage = entry.coverage;
        coverageReason = entry.coverageReason;
      } else {
        coverage = serviceChargeCoverage(service, "Expense", entry.entryDate);
      }
    }

    const resolved = resolveProjectPostingAccount(
      context,
      entry.entryDate,
      coverage
    );
    if (resolved.treatment === "Capitalize") {
      throw new ProjectChargeError(
        "An expense entry cannot charge a capital project. Use a charge or a purchase invoice."
      );
    }
    const isStatistical = resolved.treatment === "Statistical";
    const amount = round(Number(entry.amount));

    let journalId: string | null = null;
    let debitLineId: string | null = null;
    // The journal is written for every company: Provisional before the
    // accounting cutover, Posted after it (postProjectJournal).
    if (amount !== 0) {
      const defaults = await trx
        .selectFrom("accountDefault")
        .select(["goodsReceivedNotInvoicedAccount", "indirectCostAccount"])
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      const debitAccount = isStatistical
        ? defaults?.indirectCostAccount
        : resolved.accountId;
      if (!debitAccount) {
        throw new ProjectChargeError(
          "Set Indirect Cost in Account Defaults before you charge an expense to a Statistical project"
        );
      }
      if (!defaults?.goodsReceivedNotInvoicedAccount) {
        throw new Error(
          "goodsReceivedNotInvoicedAccount not configured in account defaults"
        );
      }

      const posted = await postProjectJournal(trx, {
        companyId,
        userId,
        postingDate: entry.entryDate,
        description: `${isReversal ? "Reverse expense" : "Expense"}: ${entry.description}`,
        sourceType: "Project Expense",
        documentType: "Project Expense",
        documentId: entry.id,
        documentLineReference: journalReference.to.projectExpense(entry.id),
        lines: [
          {
            accountId: debitAccount,
            description: isStatistical
              ? "Indirect Cost"
              : service
                ? "Service Expense"
                : "Project Expense",
            amount: debit("expense", amount)
          },
          {
            accountId: defaults.goodsReceivedNotInvoicedAccount,
            description: "Accrued Expense",
            amount: credit("liability", amount)
          }
        ],
        dimensions: [
          ["Project", entry.projectId],
          ["ProjectElement", entry.projectElementId],
          ["Employee", entry.employeeId],
          ["Customer", service?.customerId]
        ]
      });
      journalId = posted.journalId;
      debitLineId = posted.lineIds[0] ?? null;
    }

    let projectLedgerId: string | null = null;
    if (!isStatistical) {
      const row = (
        await insertProjectLedgerRows(trx, {
          companyId,
          userId,
          rows: [
            buildProjectLedgerRow({
              companyId,
              projectId: entry.projectId,
              projectElementId: entry.projectElementId,
              postingDate: entry.entryDate,
              costType: "Other Direct",
              documentType: "Project Expense",
              documentId: entry.id,
              employeeId: entry.employeeId,
              quantity: isReversal ? -1 : 1,
              amount,
              journalLineId: debitLineId,
              reversalOfId: original?.id ?? null,
              coverage,
              coverageReason,
              unallowable: isUnallowableCharge(context, resolved.accountId),
              createdBy: userId
            })
          ]
        })
      )[0]!;
      projectLedgerId = row.id;

      if (service && original) {
        const item = await trx
          .selectFrom("projectBillableItem")
          .selectAll()
          .where("projectLedgerId", "=", original.id)
          .where("reversalOfId", "is", null)
          .where("companyId", "=", companyId)
          .executeTakeFirst();
        if (item) {
          const reversal = reverseBillableItem(item, {
            projectLedgerId: row.id,
            createdBy: userId
          });
          if (reversal.update) {
            await trx
              .updateTable("projectBillableItem")
              .set({
                ...reversal.update,
                updatedBy: userId,
                updatedAt: datetime.timestamp()
              })
              .where("id", "=", item.id)
              .where("companyId", "=", companyId)
              .execute();
          }
          if (reversal.insert) {
            await trx
              .insertInto("projectBillableItem")
              .values(reversal.insert)
              .execute();
          }
        }
      } else if (service && coverage) {
        const item = buildBillableItem({
          ledgerRow: {
            id: row.id,
            companyId,
            projectId: entry.projectId,
            projectElementId: entry.projectElementId,
            costType: "Other Direct",
            quantity: 1,
            amount,
            itemId: null,
            createdBy: userId
          },
          coverage,
          laborPrice: null,
          partPrice: null,
          description: entry.description
        });
        if (item) {
          await trx.insertInto("projectBillableItem").values(item).execute();
        }
      }
    }

    await trx
      .updateTable("projectExpenseEntry")
      .set({
        journalId,
        coverage: service ? coverage : entry.coverage,
        coverageReason: service ? coverageReason : entry.coverageReason,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", entry.id)
      .where("companyId", "=", companyId)
      .execute();

    if (!isReversal) {
      await startElementsOnFirstCharge(trx, companyId, [
        entry.projectElementId
      ]);
    }

    return { success: true, posted: true, journalId, projectLedgerId };
  });
}

// ---------------------------------------------------------------------------
// post-project-issue

export const postProjectIssueInput = z.object({
  projectId: z.string(),
  projectElementId: z.string().optional().nullable(),
  itemId: z.string(),
  locationId: z.string(),
  storageUnitId: z.string().optional().nullable(),
  trackedEntityId: z.string().optional().nullable(),
  quantity: z.number().gt(0),
  direction: z.enum(["Issue", "Return"]),
  /** A Service project's issue: the user's coverage, with its reason. */
  coverage: z
    .enum(Constants.public.Enums.serviceCoverage)
    .optional()
    .nullable(),
  coverageReason: z.string().optional().nullable(),
  /** A Service project's return: the issue it reverses (else the latest
   *  open issue of the same part to the node). */
  returnOfProjectLedgerId: z.string().optional().nullable()
});

export type PostProjectIssueResult = {
  success: true;
  itemLedgerId: string;
  journalId: string | null;
  cost: number;
  projectLedgerId: string | null;
};

export const postProjectIssuePermission = {
  update: "inventory"
} satisfies PermissionRule<z.output<typeof postProjectIssueInput>>;

/**
 * Issues stock to a project (or returns it). The stock leaves (or re-enters)
 * inventory at its carrying cost through the inventory-adjustment core, and
 * the offset posts to the project account the cost treatment resolves:
 * Dr project / Cr inventory for an Issue, the mirror for a Return. One
 * projectLedger Material row records the same cost. A Statistical project
 * charges indirectCostAccount and writes no ledger row.
 *
 * A Return values the stock at the item's current cost (the increase rule of
 * `bookAdjustment`), and the ledger row uses that same cost, so the project
 * total equals the GL.
 *
 * On a Service project (By Coverage) the charge's coverage decides the
 * account: the user's override with a reason, else `resolveCoverage` for a
 * part. The issue writes a billable item and installs the part in the
 * customer asset (`installServicePart`). A return reverses one whole issue at
 * its coverage (`reversalOfId` on the ledger row) and undoes the install.
 */
export async function postProjectIssue(
  ctx: ServiceContext,
  raw: z.input<typeof postProjectIssueInput>
): Promise<PostProjectIssueResult> {
  const input = postProjectIssueInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const {
    projectId,
    itemId,
    locationId,
    quantity,
    direction,
    storageUnitId = null,
    trackedEntityId = null
  } = input;
  const projectElementId = input.projectElementId ?? null;
  const isIssue = direction === "Issue";

  // The ids come from the caller: re-read them under companyId.
  await inOrder([
    () =>
      assertCompanyRecords(db, "project", [projectId], companyId, "Project"),
    () => assertCompanyRecords(db, "item", [itemId], companyId, "Item"),
    () =>
      assertCompanyRecords(db, "location", [locationId], companyId, "Location"),
    () =>
      assertCompanyRecords(
        db,
        "storageUnit",
        [storageUnitId],
        companyId,
        "Storage unit"
      ),
    () =>
      assertCompanyRecords(
        db,
        "trackedEntity",
        [trackedEntityId],
        companyId,
        "Tracked entity"
      )
  ]);

  const postingDate = datetime
    .today(await getCompanyTimeZone(db, companyId))
    .toString();

  const [itemResult, itemCostResult, accountDefaults, dimensions, quantities] =
    await inOrder([
      () =>
        single(
          db,
          "item",
          { id: itemId, companyId },
          { columns: ["name", "itemTrackingType", "replenishmentSystem"] }
        ),
      () =>
        single(
          db,
          "itemCost",
          { itemId, companyId },
          {
            columns: [
              "costingMethod",
              "unitCost",
              "standardCost",
              "itemPostingGroupId"
            ]
          }
        ),
      () =>
        db
          .selectFrom("accountDefault")
          .select([
            "rawMaterialsAccount",
            "finishedGoodsAccount",
            "inventoryAdjustmentVarianceAccount",
            "indirectCostAccount"
          ])
          .where("companyId", "=", companyId)
          .executeTakeFirst(),
      () =>
        db
          .selectFrom("dimension")
          .innerJoin(
            "company",
            "company.companyGroupId",
            "dimension.companyGroupId"
          )
          .select(["dimension.id", "dimension.entityType"])
          .where("company.id", "=", companyId)
          .where("dimension.active", "=", true)
          .where("dimension.entityType", "in", [
            "Item",
            "ItemPostingGroup",
            "Location",
            "Project",
            "ProjectElement",
            "Customer"
          ])
          .execute(),
      () =>
        rpcRows(db, "get_item_quantities_by_tracking_id", {
          item_id: itemId,
          company_id: companyId,
          location_id: locationId
        })
    ]);

  if (itemResult.error) throw new Error("Failed to fetch item");
  if (itemCostResult.error) throw new Error("Failed to fetch item cost");
  if (quantities.error) throw new Error("Failed to fetch current quantities");
  if (!accountDefaults) throw new Error("Error getting account defaults");

  const isTracked =
    itemResult.data.itemTrackingType === "Serial" ||
    itemResult.data.itemTrackingType === "Batch";
  if (isTracked && !trackedEntityId) {
    throw new InvalidInputError(
      `Select the ${itemResult.data.itemTrackingType === "Serial" ? "serial number" : "batch"} to ${isIssue ? "issue" : "return"}`
    );
  }

  // Only the fields this function reads.
  type TrackingQuantityRow = {
    trackedEntityId: string | null;
    storageUnitId: string | null;
    quantity: number | null;
    projectId: string | null;
  };
  const trackingRows = (quantities.data ?? []) as TrackingQuantityRow[];

  // The stripes the project's demand may draw (Projects Phase 2a): its own
  // stock first when it has project stock, then common stock. A Return goes
  // back to the first: the project's stock, else common stock.
  const stripes = await loadDemandStripes(db, companyId, projectId);
  let draws: StripeQuantity[];
  if (!isIssue) {
    draws = [{ stripe: stripes[0] ?? null, quantity }];
  } else if (trackedEntityId) {
    // A tracked entity is drawn from its own stripe, which the project's
    // demand must be allowed to draw.
    const stripe = trackedEntityStripe(
      trackingRows.map((row) => ({
        trackedEntityId: row.trackedEntityId,
        projectId: row.projectId,
        quantity: row.quantity
      })),
      trackedEntityId
    );
    const source = trackingRows.find(
      (row) =>
        row.trackedEntityId === trackedEntityId &&
        (row.projectId ?? null) === stripe
    );
    if (round(quantity) > round(source?.quantity ?? 0)) {
      throw new InvalidInputError("Insufficient quantity to issue");
    }
    if (!stripes.includes(stripe)) {
      const entity = await single(
        db,
        "trackedEntity",
        { id: trackedEntityId, companyId },
        { columns: ["readableId"] }
      );
      await assertEntitiesInStripes(
        db,
        companyId,
        [{ readableId: entity.data?.readableId ?? null, stripe }],
        stripes
      );
    }
    draws = [{ stripe, quantity }];
  } else {
    // Untracked stock at the bin, stripe by stripe in draw order.
    // null == undefined — loose equality, as the adjustment path matches.
    const available = stripes.map((stripe) => ({
      stripe,
      quantity: trackingRows
        .filter(
          (row) =>
            row.trackedEntityId == null &&
            row.storageUnitId == storageUnitId &&
            (row.projectId ?? null) === stripe
        )
        .reduce((sum, row) => sum + Number(row.quantity ?? 0), 0)
    }));
    const split = splitAcrossStripes(quantity, available);
    if (round(split.remaining) > 0) {
      throw new InvalidInputError("Insufficient quantity to issue");
    }
    // One stripe (no project stock) books the quantity as given.
    draws =
      stripes.length === 1
        ? [{ stripe: stripes[0] ?? null, quantity }]
        : split.draws;
  }

  const dimensionMap: Record<string, string> = {};
  for (const dimension of dimensions) {
    if (dimension.entityType) {
      dimensionMap[dimension.entityType] = dimension.id;
    }
  }

  return db.transaction().execute(async (trx) => {
    const contexts = await loadProjectPostingContexts(trx, companyId, [
      { projectId, projectElementId }
    ]);
    const context = contexts.get(
      projectPostingKey(projectId, projectElementId)
    );
    if (!context) throw new NotFoundError("Project element not found");
    assertChargeable(context, isIssue ? "new" : "commitment");

    // A Service project: the coverage decides the account.
    const service =
      context.project.costTreatment === "By Coverage"
        ? await loadServicePostingContext(trx, {
            companyId,
            projectId,
            elementId: projectElementId
          })
        : null;
    if (context.project.costTreatment === "By Coverage" && !service) {
      throw new ProjectChargeError(
        "No service order owns the project of this issue"
      );
    }
    let coverage: ServiceCoverage | null = null;
    let coverageReason: string | null = null;
    let returnedIssue: ServiceIssue | null = null;
    if (service && isIssue) {
      const override = input.coverage && input.coverageReason?.trim();
      coverage = override
        ? input.coverage!
        : serviceChargeCoverage(service, "Part", postingDate);
      coverageReason = override ? input.coverageReason!.trim() : null;
    } else if (service) {
      returnedIssue = await findServiceIssueToReturn(trx, {
        companyId,
        projectId,
        projectElementId,
        itemId,
        trackedEntityId,
        quantity,
        returnOfProjectLedgerId: input.returnOfProjectLedgerId ?? null
      });
      coverage = returnedIssue.coverage;
      coverageReason = returnedIssue.coverageReason;
    }

    const resolved = resolveProjectPostingAccount(
      context,
      postingDate,
      coverage
    );
    const { treatment, accountId } = resolved;
    const isStatistical = treatment === "Statistical";
    const offsetAccount = isStatistical
      ? accountDefaults.indirectCostAccount
      : accountId;
    if (!offsetAccount) {
      throw new ProjectChargeError(
        "Set Indirect Cost in Account Defaults before you issue to a Statistical project"
      );
    }

    if (trackedEntityId) {
      const entity = await trx
        .selectFrom("trackedEntity")
        .select(["quantity", "status"])
        .where("id", "=", trackedEntityId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      await trx
        .updateTable("trackedEntity")
        .set(
          settleQuantity({
            quantity:
              Number(entity.quantity) + (isIssue ? -quantity : quantity),
            // A returned unit is back in stock.
            status:
              !isIssue && entity.status === "Consumed"
                ? "Available"
                : entity.status,
            refusal: "Insufficient quantity to issue"
          })
        )
        .where("id", "=", trackedEntityId)
        .where("companyId", "=", companyId)
        .execute();
    }

    // Every issue writes its journal: Provisional before the company's
    // accounting cutover, Posted after it. FOR SHARE holds the status until
    // commit. A Provisional journal has no accounting period.
    const postingStatus = await journalPostingStatus(trx, companyId);
    const accountingPeriodId =
      postingStatus === "Posted"
        ? (
            await resolveAccountingPeriod(
              trx,
              companyId,
              postingDate,
              "current"
            )
          ).id
        : null;

    // One journal for every stripe drawn, created on the first movement
    // that carries value.
    let sharedJournalId: string | null = null;
    const getJournalId = async () => {
      if (!sharedJournalId) {
        sharedJournalId = await createAdjustmentJournal(trx, {
          companyId,
          accountingPeriodId,
          status: postingStatus,
          description: journalDescription,
          postingDate,
          userId,
          sourceType: "Project Issue"
        });
      }
      return sharedJournalId;
    };
    const journalDescription = `${isIssue ? "Issue to" : "Return from"} Project ${
      context.project.identifier || context.project.name || projectId
    }`;

    // One adjustment per stripe drawn; the project is charged their sum.
    const bookedRows: {
      itemLedgerId: string;
      offsetJournalLineId: string | null;
      cost: number;
    }[] = [];
    for (const draw of draws) {
      const bookedRow = await bookAdjustment(trx, {
        ledger: {
          postingDate,
          itemId,
          quantity: isIssue ? -draw.quantity : draw.quantity,
          locationId,
          storageUnitId,
          trackedEntityId,
          projectId: draw.stripe,
          entryType: isIssue ? "Negative Adjmt." : "Positive Adjmt.",
          documentType: "Project Issue",
          documentId: projectId,
          companyId,
          createdBy: userId
        },
        item: {
          itemTrackingType: itemResult.data.itemTrackingType,
          replenishmentSystem: itemResult.data.replenishmentSystem,
          itemPostingGroupId: itemCostResult.data.itemPostingGroupId
        },
        itemCost: itemCostResult.data,
        accounting: {
          postingStatus,
          accountingPeriodId,
          accountDefaults: {
            rawMaterialsAccount: accountDefaults.rawMaterialsAccount,
            finishedGoodsAccount: accountDefaults.finishedGoodsAccount,
            inventoryAdjustmentVarianceAccount:
              accountDefaults.inventoryAdjustmentVarianceAccount
          },
          offsetAccount,
          offsetDescription: isStatistical
            ? "Indirect Cost"
            : service
              ? "Service Material"
              : "Project Material",
          sourceType: "Project Issue",
          description: journalDescription,
          getJournalId,
          userId,
          dimensions: dimensionMap,
          extraDimensions: [
            { entityType: "Project", valueId: projectId },
            ...(projectElementId
              ? [
                  {
                    entityType: "ProjectElement",
                    valueId: projectElementId
                  }
                ]
              : []),
            ...(service?.customerId
              ? [{ entityType: "Customer", valueId: service.customerId }]
              : [])
          ]
        }
      });
      bookedRows.push(bookedRow);
    }
    const booked = {
      itemLedgerId: bookedRows[0]!.itemLedgerId,
      journalId: sharedJournalId as string | null,
      // Every stripe's offset line is on the one project account, so the
      // first one tells the revenue run which account the row charged.
      offsetJournalLineId:
        bookedRows.find((row) => row.offsetJournalLineId)
          ?.offsetJournalLineId ?? null,
      cost: round(bookedRows.reduce((sum, row) => sum + row.cost, 0))
    };

    let projectLedgerId: string | null = null;
    if (!isStatistical) {
      const row = (
        await insertProjectLedgerRows(trx, {
          companyId,
          userId,
          rows: [
            buildProjectLedgerRow({
              companyId,
              projectId,
              projectElementId,
              postingDate,
              costType: "Material",
              documentType: "Project Issue",
              documentId: booked.itemLedgerId,
              itemId,
              quantity: isIssue ? quantity : -quantity,
              amount: isIssue ? booked.cost : -booked.cost,
              journalLineId: booked.offsetJournalLineId,
              reversalOfId: returnedIssue?.id ?? null,
              coverage,
              coverageReason,
              unallowable: isUnallowableCharge(context, accountId),
              createdBy: userId
            })
          ]
        })
      )[0]!;
      projectLedgerId = row.id;

      if (service && isIssue && coverage) {
        await installServicePart(trx, {
          companyId,
          userId,
          service,
          projectId,
          projectElementId,
          projectLedgerId: row.id,
          itemLedgerId: booked.itemLedgerId,
          itemId,
          itemName: itemResult.data.name,
          trackedEntityId,
          quantity,
          postingDate,
          coverage
        });
      } else if (service && returnedIssue) {
        await uninstallServicePart(trx, {
          companyId,
          userId,
          service,
          projectElementId,
          issueLedgerId: returnedIssue.id,
          issueItemLedgerId: returnedIssue.documentId,
          returnLedgerId: row.id
        });
      }

      // An issue to a Capitalize project builds its asset.
      await writeProjectCipRows(trx, {
        companyId,
        userId,
        rows: [
          buildProjectCipRow({
            resolved,
            companyId,
            userId,
            projectId,
            projectElementId,
            sourceType: "Project Issue",
            sourceDocumentId: booked.itemLedgerId,
            amount: isIssue ? booked.cost : -booked.cost,
            costDate: postingDate,
            journalId: booked.journalId
          })
        ]
      });
    }

    if (projectElementId) {
      // The element's plan line for the item, if it has one (the oldest
      // when it has several).
      await sql`
          UPDATE "projectElementMaterial"
          SET "quantityIssued" = "quantityIssued" + ${
            isIssue ? quantity : -quantity
          }::numeric,
              "updatedBy" = ${userId},
              "updatedAt" = NOW()
          WHERE "id" = (
            SELECT "id" FROM "projectElementMaterial"
            WHERE "projectElementId" = ${projectElementId}
              AND "projectId" = ${projectId}
              AND "itemId" = ${itemId}
              AND "companyId" = ${companyId}
            ORDER BY "createdAt", "id"
            LIMIT 1
          )
          AND "companyId" = ${companyId}
        `.execute(trx);

      if (isIssue) {
        await startElementsOnFirstCharge(trx, companyId, [projectElementId]);
      }
    }

    return {
      success: true,
      itemLedgerId: booked.itemLedgerId,
      journalId: booked.journalId,
      cost: booked.cost,
      projectLedgerId
    };
  });
}

// ---------------------------------------------------------------------------
// post-project-stock-transfer

export const postProjectStockTransferInput = z.object({
  projectStockTransferId: z.string()
});

export type PostProjectStockTransferResult = {
  success: true;
  journalId: string | null;
};

export const postProjectStockTransferPermission = {
  update: "projects"
} satisfies PermissionRule<z.output<typeof postProjectStockTransferInput>>;

/**
 * Posts an Approved project stock transfer (Projects Phase 2a): stock moves
 * between stock stripes at the same bin, at cost.
 *
 * - **Transfer**: the from-stripe's layers are relieved (calculateCOGS) and a
 *   layer at the drawn cost opens in the to-stripe. The drawn cost includes the
 *   relieved layers' adjustment children, so their value moves with them. No
 *   journal: both owners are inventory.
 * - **Borrow**: the same move from the lender to the borrower, whose layer
 *   points at a new open `projectBorrow` (quantity, borrowed unit cost, due
 *   date). No journal.
 * - **Payback**: the borrower's stock is relieved at its current cost and the
 *   lender gets back the borrowed cost, one layer per borrow settled (oldest
 *   open borrow of the item first, starting from the one the payback names).
 *   The difference is the borrower's Payback Variance: a projectLedger row and
 *   a journal of the variance against inventory, tagged with the borrower's
 *   project.
 *
 * Government-furnished stock never leaves for common stock or for a project
 * of another customer.
 */
export async function postProjectStockTransfer(
  ctx: ServiceContext,
  raw: z.input<typeof postProjectStockTransferInput>
): Promise<PostProjectStockTransferResult> {
  const { projectStockTransferId } = postProjectStockTransferInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const postingDate = datetime
    .today(await getCompanyTimeZone(db, companyId))
    .toString();

  const [accountDefaults, dimensions] = await inOrder([
    () =>
      db
        .selectFrom("accountDefault")
        .select([
          "rawMaterialsAccount",
          "finishedGoodsAccount",
          "inventoryAdjustmentVarianceAccount"
        ])
        .where("companyId", "=", companyId)
        .executeTakeFirst(),
    () =>
      db
        .selectFrom("dimension")
        .innerJoin(
          "company",
          "company.companyGroupId",
          "dimension.companyGroupId"
        )
        .select(["dimension.id", "dimension.entityType"])
        .where("company.id", "=", companyId)
        .where("dimension.active", "=", true)
        .where("dimension.entityType", "in", [
          "Item",
          "ItemPostingGroup",
          "Location",
          "Project"
        ])
        .execute()
  ]);
  if (!accountDefaults) throw new Error("Error getting account defaults");
  const dimensionMap: Record<string, string> = {};
  for (const dimension of dimensions) {
    if (dimension.entityType) {
      dimensionMap[dimension.entityType] = dimension.id;
    }
  }

  return db.transaction().execute(async (trx) => {
    const header = await trx
      .selectFrom("projectStockTransfer")
      .selectAll()
      .where("id", "=", projectStockTransferId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!header) throw new NotFoundError("Project stock transfer not found");
    if (header.status !== "Approved") {
      throw new InvalidInputError(
        `Only an approved transfer can be posted; this one is ${header.status}`
      );
    }

    const lines = await trx
      .selectFrom("projectStockTransferLine")
      .selectAll()
      .where("projectStockTransferId", "=", header.id)
      .where("companyId", "=", companyId)
      .orderBy("createdAt")
      .orderBy("id")
      .execute();
    if (lines.length === 0) {
      throw new InvalidInputError("Add a line before you post the transfer");
    }

    // The owners. A Payback runs from the borrower back to the lender of
    // the borrow it settles.
    let fromProjectId = header.fromProjectId;
    let toProjectId = header.toProjectId;
    if (header.type === "Payback") {
      const borrow = await trx
        .selectFrom("projectBorrow")
        .select(["borrowerProjectId", "lenderProjectId", "status"])
        .where("id", "=", header.settlesBorrowId!)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!borrow) throw new NotFoundError("Borrow not found");
      if (borrow.status !== "Open") {
        throw new InvalidInputError("The borrow is already paid back");
      }
      if (
        (header.fromProjectId &&
          header.fromProjectId !== borrow.borrowerProjectId) ||
        (header.toProjectId && header.toProjectId !== borrow.lenderProjectId)
      ) {
        throw new InvalidInputError(
          "A payback runs from the borrower back to the lender"
        );
      }
      fromProjectId = borrow.borrowerProjectId;
      toProjectId = borrow.lenderProjectId;
    }
    if (fromProjectId === toProjectId) {
      throw new InvalidInputError("The transfer needs two different owners");
    }

    // Government-furnished stock stays with its customer.
    const ownerIds = [fromProjectId, toProjectId].filter((id): id is string =>
      Boolean(id)
    );
    const owners =
      ownerIds.length > 0
        ? await trx
            .selectFrom("project")
            .select([
              "id",
              "identifier",
              "name",
              "customerId",
              "governmentFurnished"
            ])
            .where("id", "in", ownerIds)
            .where("companyId", "=", companyId)
            .execute()
        : [];
    const fromProject = owners.find((p) => p.id === fromProjectId);
    const toProject = owners.find((p) => p.id === toProjectId);
    if (fromProject?.governmentFurnished) {
      if (
        !toProject ||
        !fromProject.customerId ||
        toProject.customerId !== fromProject.customerId
      ) {
        throw new InvalidInputError(
          `Government-furnished stock of project ${
            fromProject.identifier || fromProject.name
          } can only move to a project of the same customer`
        );
      }
    }

    const itemIds = [...new Set(lines.map((line) => line.itemId))];
    const [items, itemCosts, onHand] = await Promise.all([
      trx
        .selectFrom("item")
        .select(["id", "itemTrackingType", "replenishmentSystem"])
        .where("id", "in", itemIds)
        .where("companyId", "=", companyId)
        .execute(),
      trx
        .selectFrom("itemCost")
        .select(["itemId", "itemPostingGroupId"])
        .where("itemId", "in", itemIds)
        .where("companyId", "=", companyId)
        .execute(),
      // The from-stripe's on-hand at the transfer's location, per bin and
      // lot: what the lines may move.
      trx
        .selectFrom("itemLedger")
        .select([
          "itemId",
          "storageUnitId",
          "trackedEntityId",
          (eb) => eb.fn.sum<number>("quantity").as("quantity")
        ])
        .where("companyId", "=", companyId)
        .where("locationId", "=", header.locationId)
        .where("itemId", "in", itemIds)
        .where((eb) =>
          fromProjectId
            ? eb("projectId", "=", fromProjectId)
            : eb("projectId", "is", null)
        )
        .groupBy(["itemId", "storageUnitId", "trackedEntityId"])
        .execute()
    ]);
    const itemById = new Map(items.map((item) => [item.id, item]));
    const postingGroupByItem = new Map(
      itemCosts.map((cost) => [cost.itemId, cost.itemPostingGroupId])
    );
    const slotKey = (
      itemId: string,
      storageUnitId: string | null,
      trackedEntityId: string | null
    ) => `${itemId}\u0000${storageUnitId ?? ""}\u0000${trackedEntityId ?? ""}`;
    const available = new Map<string, number>();
    for (const row of onHand) {
      available.set(
        slotKey(row.itemId, row.storageUnitId, row.trackedEntityId),
        Number(row.quantity ?? 0)
      );
    }
    const requested = new Map<string, number>();
    for (const line of lines) {
      const item = itemById.get(line.itemId);
      if (!item || item.itemTrackingType === "Non-Inventory") {
        throw new InvalidInputError("Only stocked items can be transferred");
      }
      const tracked =
        item.itemTrackingType === "Serial" || item.itemTrackingType === "Batch";
      if (tracked && !line.trackedEntityId) {
        throw new InvalidInputError(
          "Select the lot or serial number of every tracked line"
        );
      }
      const key = slotKey(
        line.itemId,
        line.storageUnitId,
        line.trackedEntityId
      );
      requested.set(key, (requested.get(key) ?? 0) + Number(line.quantity));
    }
    for (const [key, quantity] of requested) {
      if (round(quantity) > round(available.get(key) ?? 0)) {
        throw new InvalidInputError(
          `Insufficient quantity in the ${
            fromProject
              ? `stock of project ${fromProject.identifier || fromProject.name}`
              : "unassigned stock"
          } to transfer`
        );
      }
    }

    // A payback variance writes a journal: Provisional before the
    // company's accounting cutover, Posted after it. FOR SHARE holds the
    // status until commit. A Provisional journal has no accounting period.
    const postingStatus = await journalPostingStatus(trx, companyId);
    const accountingPeriodId =
      postingStatus === "Posted" && header.type === "Payback"
        ? (
            await resolveAccountingPeriod(
              trx,
              companyId,
              postingDate,
              "current"
            )
          ).id
        : null;
    // One journal for the paybacks of every line, created on the first
    // variance.
    let journalId: string | null = null;
    const getJournalId = async () => {
      if (!journalId) {
        journalId = await createAdjustmentJournal(trx, {
          companyId,
          accountingPeriodId,
          status: postingStatus,
          description: `Payback ${header.projectStockTransferId}`,
          postingDate,
          userId,
          sourceType: "Project Transfer"
        });
      }
      return journalId;
    };

    for (const line of lines) {
      const item = itemById.get(line.itemId)!;
      const quantity = Number(line.quantity);
      // A serial unit is costed by specific identification, as every
      // adjustment is (valueMovement).
      const serialId =
        item.itemTrackingType === "Serial" ? line.trackedEntityId : null;

      // 1. Draw from the from-stripe: its layers are relieved.
      const cogs = await calculateCOGS(trx, {
        itemId: line.itemId,
        quantity,
        companyId,
        projectId: fromProjectId,
        trackedEntityIds: serialId ? [serialId] : []
      });
      const unitCost = quantity > 0 ? cogs.totalCost / quantity : 0;

      // 2. The Transfer pair at the same bin, one leg per stripe.
      const ledgerBase = {
        postingDate,
        entryType: "Transfer" as const,
        documentType: "Project Transfer" as const,
        documentId: header.id,
        itemId: line.itemId,
        locationId: header.locationId,
        storageUnitId: line.storageUnitId,
        trackedEntityId: line.trackedEntityId,
        companyId,
        createdBy: userId
      };
      await trx
        .insertInto("itemLedger")
        .values([
          buildItemLedgerRow({
            ...ledgerBase,
            quantity: -quantity,
            projectId: fromProjectId
          }),
          buildItemLedgerRow({
            ...ledgerBase,
            quantity,
            projectId: toProjectId
          })
        ])
        .execute();

      const layerBase = {
        entryType: "Transfer" as const,
        documentType: "Project Transfer" as const,
        documentId: header.id,
        itemId: line.itemId,
        postingDate,
        trackedEntityId: serialId,
        companyId
      };
      // The relief row of the drawn layers (remaining 0).
      await trx
        .insertInto("costLedger")
        .values(
          buildCostLedgerRow({
            ...layerBase,
            quantity: -quantity,
            cost: -cogs.totalCost,
            projectId: fromProjectId
          })
        )
        .execute();

      if (header.type === "Transfer") {
        await trx
          .insertInto("costLedger")
          .values(
            buildCostLedgerRow({
              ...layerBase,
              quantity,
              cost: cogs.totalCost,
              projectId: toProjectId
            })
          )
          .execute();
      } else if (header.type === "Borrow") {
        const borrow = await trx
          .insertInto("projectBorrow")
          .values({
            borrowerProjectId: toProjectId!,
            lenderProjectId: fromProjectId!,
            itemId: line.itemId,
            locationId: header.locationId,
            quantity,
            borrowedUnitCost: round(unitCost),
            paybackDueDate: header.paybackDueDate!,
            status: "Open",
            projectStockTransferLineId: line.id,
            companyId,
            createdBy: userId
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("costLedger")
          .values({
            ...buildCostLedgerRow({
              ...layerBase,
              quantity,
              cost: cogs.totalCost,
              projectId: toProjectId
            }),
            projectBorrowId: borrow.id
          })
          .execute();
      } else {
        // Payback: the open borrows of this item between the two projects,
        // the one the payback names first, then the oldest.
        const openBorrows = await trx
          .selectFrom("projectBorrow")
          .select([
            "id",
            "quantity",
            "quantityPaidBack",
            "borrowedUnitCost",
            "createdAt"
          ])
          .where("companyId", "=", companyId)
          .where("borrowerProjectId", "=", fromProjectId!)
          .where("lenderProjectId", "=", toProjectId!)
          .where("itemId", "=", line.itemId)
          .where("locationId", "=", header.locationId)
          .where("status", "=", "Open")
          .orderBy("createdAt")
          .orderBy("id")
          .forUpdate()
          .execute();
        const ordered = [
          ...openBorrows.filter((b) => b.id === header.settlesBorrowId),
          ...openBorrows.filter((b) => b.id !== header.settlesBorrowId)
        ];
        const settlements = planBorrowMatching(
          ordered.map((b) => ({
            id: b.id,
            quantity: Number(b.quantity),
            quantityPaidBack: Number(b.quantityPaidBack),
            borrowedUnitCost: Number(b.borrowedUnitCost)
          })),
          quantity
        );

        let variance = 0;
        for (const settlement of settlements) {
          // The lender gets back the cost it lent.
          await trx
            .insertInto("costLedger")
            .values({
              ...buildCostLedgerRow({
                ...layerBase,
                quantity: settlement.quantity,
                cost: settlement.quantity * settlement.borrowedUnitCost,
                projectId: toProjectId
              }),
              projectBorrowId: settlement.borrowId
            })
            .execute();
          const borrowed = ordered.find((b) => b.id === settlement.borrowId)!;
          await trx
            .updateTable("projectBorrow")
            .set({
              quantityPaidBack: round(
                Number(borrowed.quantityPaidBack) + settlement.quantity
              ),
              status: settlement.paidBack ? "Paid Back" : "Open",
              updatedBy: userId,
              updatedAt: datetime.timestamp()
            })
            .where("id", "=", settlement.borrowId)
            .where("companyId", "=", companyId)
            .execute();
          variance += paybackVariance(
            settlement.borrowedUnitCost,
            unitCost,
            settlement.quantity
          );
        }
        variance = round(variance);

        if (variance !== 0) {
          // The borrower takes the difference: Dr variance / Cr inventory
          // when it paid back dearer stock, the mirror when cheaper.
          const journalLines = await trx
            .insertInto("journalLine")
            .values(
              buildAdjustmentJournalLines({
                journalId: await getJournalId(),
                documentId: header.id,
                documentType: "Project Transfer",
                journalLineReference: nanoid(),
                isGain: variance < 0,
                cost: Math.abs(variance),
                quantity,
                replenishmentSystem: item.replenishmentSystem,
                accountDefaults,
                offsetDescription: "Payback Variance",
                companyId
              })
            )
            .returning("id")
            .execute();
          const journalLineId = journalLines[1]?.id ?? null;
          const tags = buildJournalLineDimensions({
            journalLineIds: journalLines.map((jl) => jl.id),
            dimensions: dimensionMap,
            itemId: line.itemId,
            itemPostingGroupId: postingGroupByItem.get(line.itemId),
            locationId: header.locationId,
            extraDimensions: [
              { entityType: "Project", valueId: fromProjectId! }
            ],
            companyId
          });
          if (tags.length > 0) {
            await trx.insertInto("journalLineDimension").values(tags).execute();
          }
          await insertProjectLedgerRows(trx, {
            companyId,
            userId,
            rows: [
              buildProjectLedgerRow({
                companyId,
                projectId: fromProjectId!,
                projectElementId: null,
                postingDate,
                costType: "Payback Variance",
                documentType: "Project Transfer",
                documentId: header.id,
                documentLineId: line.id,
                itemId: line.itemId,
                quantity,
                amount: variance,
                journalLineId,
                // A payback variance sits on the project root (no element)
                // and posts to the inventory variance account, not to a
                // project account: no allowability decides it.
                unallowable: false,
                createdBy: userId
              })
            ]
          });
        }
      }

      // 3. The line records the cost it moved at.
      await trx
        .updateTable("projectStockTransferLine")
        .set({
          unitCost: round(unitCost),
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", line.id)
        .where("companyId", "=", companyId)
        .execute();
    }

    await trx
      .updateTable("projectStockTransfer")
      .set({
        status: "Posted",
        // A Payback keeps the owners it posted between.
        fromProjectId,
        toProjectId,
        postedAt: datetime.timestamp(),
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", header.id)
      .where("companyId", "=", companyId)
      .execute();

    return {
      success: true,
      journalId: journalId as string | null
    };
  });
}

// ---------------------------------------------------------------------------
// reclass-project-coverage

export const reclassProjectCoverageInput = z.object({
  projectLedgerId: z.string(),
  coverage: z.enum(Constants.public.Enums.serviceCoverage),
  reason: z.string().trim().min(1)
});

export type ReclassProjectCoverageResult = {
  success: true;
  journalId: string | null;
  /** The new projectLedger row, at the new coverage. */
  projectLedgerId: string;
};

/** The source documents that carry a coverage, and their journal types. */
const SOURCE_TYPES = {
  Timesheet: "Timesheet",
  "Project Issue": "Project Issue",
  "Project Expense": "Project Expense"
} as const;

/** "Labor (Covered by warranty)" → "Labor". */
function baseDescription(description: string): string {
  return description.replace(/ \(Covered by (warranty|contract)\)$/, "");
}

export const reclassProjectCoveragePermission = {
  update: "projects"
} satisfies PermissionRule<z.output<typeof reclassProjectCoverageInput>>;

/**
 * Changes the coverage of a posted service charge without moving stock or
 * time. In one transaction it:
 * 1. refuses a charge whose billable item is Billed, or no change;
 * 2. posts Dr the new coverage's account / Cr the account the charge debited;
 * 3. writes a reversal projectLedger row and a new row at the new coverage
 *    (the ledger stays append-only);
 * 4. writes off (or credits) the old billable item and writes the new one;
 * 5. stores the coverage and reason on the source timesheet or expense entry.
 * An installed component follows its issue to the new ledger row.
 */
export async function reclassProjectCoverage(
  ctx: ServiceContext,
  raw: z.input<typeof reclassProjectCoverageInput>
): Promise<ReclassProjectCoverageResult> {
  const { projectLedgerId, coverage, reason } =
    reclassProjectCoverageInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;

  const postingDate = datetime
    .today(await getCompanyTimeZone(db, companyId))
    .toString();

  return db.transaction().execute(async (trx) => {
    // Row lock: two reclasses of one charge must not both reverse it.
    const source = await trx
      .selectFrom("projectLedger")
      .selectAll()
      .where("id", "=", projectLedgerId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!source) throw new NotFoundError("Charge not found");

    const sourceType =
      SOURCE_TYPES[source.documentType as keyof typeof SOURCE_TYPES];
    if (!source.coverage || !sourceType) {
      throw new InvalidInputError("Only a service charge has a coverage");
    }
    if (source.reversalOfId) {
      throw new InvalidInputError("A reversal cannot be reclassed");
    }
    const reversed = await trx
      .selectFrom("projectLedger")
      .select("id")
      .where("reversalOfId", "=", source.id)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (reversed) {
      throw new ProjectChargeError(
        "This charge is already reversed or reclassed"
      );
    }
    if (source.coverage === coverage) {
      throw new ProjectChargeError(`The charge is already ${coverage}`);
    }
    if (source.coverage === "Capitalized" || coverage === "Capitalized") {
      throw new ProjectChargeError(
        "Only a refurbishment charge is Capitalized, and it stays Capitalized"
      );
    }

    const billable = await trx
      .selectFrom("projectBillableItem")
      .selectAll()
      .where("projectLedgerId", "=", source.id)
      .where("reversalOfId", "is", null)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (billable?.status === "Billed") {
      throw new ProjectChargeError(
        "The charge is already invoiced. Credit the invoice first."
      );
    }

    const contexts = await loadProjectPostingContexts(trx, companyId, [
      {
        projectId: source.projectId,
        projectElementId: source.projectElementId
      }
    ]);
    const context = contexts.get(
      projectPostingKey(source.projectId, source.projectElementId)
    );
    if (!context) throw new NotFoundError("Project element not found");
    assertChargeable(context, "commitment");
    const service = await loadServicePostingContext(trx, {
      companyId,
      projectId: source.projectId,
      elementId: source.projectElementId
    });
    if (!service) {
      throw new ProjectChargeError(
        "No service order owns the project of this charge"
      );
    }

    const amount = round(Number(source.amount));
    let journalId: string | null = null;
    let debitLineId: string | null = null;
    let creditLineId: string | null = null;
    // The account the replacement posts to; null for a zero charge. The
    // journal is written for every company: Provisional before the
    // accounting cutover, Posted after it (postProjectJournal).
    let newAccount: string | null = null;
    if (amount !== 0) {
      newAccount = resolveProjectPostingAccount(
        context,
        postingDate,
        coverage
      ).accountId;
      // Credit the account the charge debited.
      const debited = source.journalLineId
        ? await trx
            .selectFrom("journalLine")
            .select("accountId")
            .where("id", "=", source.journalLineId)
            .where("companyId", "=", companyId)
            .executeTakeFirst()
        : undefined;
      const oldAccount =
        debited?.accountId ??
        resolveProjectPostingAccount(
          context,
          source.postingDate,
          source.coverage
        ).accountId;
      if (!newAccount || !oldAccount) {
        throw new ProjectChargeError(
          "The charge's coverage has no posting account"
        );
      }
      if (newAccount !== oldAccount) {
        const posted = await postProjectJournal(trx, {
          companyId,
          userId,
          postingDate,
          description: `Coverage ${source.coverage} to ${coverage}: ${reason}`,
          sourceType,
          documentType: sourceType,
          documentId: source.documentId,
          documentLineReference: journalReference.to.coverageReclass(source.id),
          lines: [
            {
              accountId: newAccount,
              description: `${coverage} Coverage`,
              amount: debit("expense", amount)
            },
            {
              accountId: oldAccount,
              description: `${source.coverage} Coverage`,
              amount: credit("expense", amount)
            }
          ],
          dimensions: [
            ["Project", source.projectId],
            ["ProjectElement", source.projectElementId],
            ["Employee", source.employeeId],
            ["Customer", service.customerId]
          ]
        });
        journalId = posted.journalId;
        debitLineId = posted.lineIds[0] ?? null;
        creditLineId = posted.lineIds[1] ?? null;
      }
    }

    const shared = {
      companyId,
      projectId: source.projectId,
      projectElementId: source.projectElementId,
      postingDate,
      costType: source.costType,
      documentType: source.documentType,
      documentId: source.documentId,
      documentLineId: source.documentLineId,
      jobId: source.jobId,
      itemId: source.itemId,
      employeeId: source.employeeId,
      laborCategoryId: source.laborCategoryId,
      supplierId: source.supplierId,
      unitOfMeasureCode: source.unitOfMeasureCode,
      createdBy: userId
    };
    const quantity = source.quantity === null ? null : Number(source.quantity);
    const reversal = (
      await insertProjectLedgerRows(trx, {
        companyId,
        userId,
        rows: [
          buildProjectLedgerRow({
            ...shared,
            quantity: quantity === null ? null : -quantity,
            amount: -amount,
            journalLineId: creditLineId,
            reversalOfId: source.id,
            coverage: source.coverage,
            coverageReason: source.coverageReason,
            unallowable: source.unallowable
          })
        ]
      })
    )[0]!;
    const replacement = (
      await insertProjectLedgerRows(trx, {
        companyId,
        userId,
        rows: [
          buildProjectLedgerRow({
            ...shared,
            quantity,
            amount,
            journalLineId: debitLineId,
            coverage,
            coverageReason: reason,
            unallowable: isUnallowableCharge(context, newAccount)
          })
        ]
      })
    )[0]!;

    const now = datetime.timestamp();
    if (billable) {
      const undo = reverseBillableItem(billable, {
        projectLedgerId: reversal.id,
        createdBy: userId
      });
      if (undo.update) {
        await trx
          .updateTable("projectBillableItem")
          .set({ ...undo.update, updatedBy: userId, updatedAt: now })
          .where("id", "=", billable.id)
          .where("companyId", "=", companyId)
          .execute();
      }
      if (undo.insert) {
        await trx
          .insertInto("projectBillableItem")
          .values(undo.insert)
          .execute();
      }
    }

    const partPrice =
      source.costType === "Material" && source.itemId
        ? await trx
            .selectFrom("itemUnitSalePrice")
            .select("unitSalePrice")
            .where("itemId", "=", source.itemId)
            .where("companyId", "=", companyId)
            .executeTakeFirst()
            .then((row) => (row ? Number(row.unitSalePrice) : null))
        : null;
    const item = buildBillableItem({
      ledgerRow: {
        id: replacement.id,
        companyId,
        projectId: source.projectId,
        projectElementId: source.projectElementId,
        costType: source.costType,
        quantity,
        amount,
        itemId:
          billable?.itemId ??
          (source.costType === "Labor" ? service.laborItemId : source.itemId),
        createdBy: userId
      },
      coverage,
      laborPrice: service.laborPrice,
      partPrice,
      description: billable
        ? baseDescription(billable.description)
        : source.costType === "Labor"
          ? "Labor"
          : "Charge"
    });
    if (item) {
      await trx.insertInto("projectBillableItem").values(item).execute();
    }

    // The source entry keeps the coverage its charge now posts at.
    if (source.documentType === "Timesheet") {
      await trx
        .updateTable("timesheetEntry")
        .set({
          coverage,
          coverageReason: reason,
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "=", source.documentId)
        .where("companyId", "=", companyId)
        .execute();
    } else if (source.documentType === "Project Expense") {
      await trx
        .updateTable("projectExpenseEntry")
        .set({
          coverage,
          coverageReason: reason,
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "=", source.documentId)
        .where("companyId", "=", companyId)
        .execute();
    } else {
      // An installed part follows its issue, so a return still finds it.
      await trx
        .updateTable("customerAssetComponent")
        .set({
          projectLedgerId: replacement.id,
          updatedBy: userId,
          updatedAt: now
        })
        .where("projectLedgerId", "=", source.id)
        .where("companyId", "=", companyId)
        .execute();
    }

    return { success: true, journalId, projectLedgerId: replacement.id };
  });
}

// ---------------------------------------------------------------------------
// post-project-burden

export const postProjectBurdenInput = z.object({
  indirectRateRunId: z.string(),
  accountingPeriodId: z.string(),
  /** YYYY-MM-DD, the period end. */
  postingDate: z.string(),
  postApplied: z.boolean(),
  rows: z
    .array(
      z.object({
        projectId: z.string(),
        projectElementId: z.string().nullable(),
        indirectPoolId: z.string(),
        indirectRateType: z.enum(["Provisional", "Actual", "Final"]),
        burdenFiscalYear: z.number().int(),
        amount: z.number(),
        unallowable: z.boolean()
      })
    )
    .max(10000)
});

export type PostProjectBurdenInput = z.infer<typeof postProjectBurdenInput>;

export const ACCOUNTING_PERIOD_CLOSED = "Accounting period is closed.";

// Annotated, not `satisfies`: the literal would widen to `string` in
// `postingPermissions`.
export const postProjectBurdenPermission: PermissionRule<
  z.output<typeof postProjectBurdenInput>
> = "system";

/**
 * Writes the Burden rows an indirect rate run computed (one per project,
 * element, pool and unallowable flag; each amount is the catch-up delta) in
 * one transaction. The rows are memo rows unless `postApplied`: then the rows
 * of Contract projects also post applied burden, Dr the project account /
 * Cr the pool's applied account, in one journal with source type Burden. The
 * journal is Provisional before the company's accounting cutover (no
 * period) and Posted in `accountingPeriodId` after it. A Locked period
 * accepts the call (an accounting adjustment); a Closed one refuses it.
 * Called only by the commercial indirect rate runs, after their own checks.
 */
export async function postProjectBurden(
  ctx: ServiceContext,
  raw: z.input<typeof postProjectBurdenInput>
): Promise<PostProjectBurdenResult> {
  const input = postProjectBurdenInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const rows = input.rows.filter((row) => !equals(round(row.amount), 0));

  return db.transaction().execute(async (trx) => {
    const period = await trx
      .selectFrom("accountingPeriod")
      .select(["id", "closeStatus", "closedAt"])
      .where("id", "=", input.accountingPeriodId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!period) throw new NotFoundError("Accounting period not found");
    if (period.closeStatus === "Closed" || period.closedAt !== null) {
      throw new ServerFnError(ACCOUNTING_PERIOD_CLOSED, 422);
    }

    const run = await trx
      .selectFrom("indirectRateRun")
      .select("id")
      .where("id", "=", input.indirectRateRunId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!run) throw new NotFoundError("Indirect rate run not found");

    if (rows.length === 0) {
      return { success: true, journalId: null, projectLedgerIds: [] };
    }

    const poolIds = [...new Set(rows.map((row) => row.indirectPoolId))];
    const [, pools] = await inOrder([
      () =>
        assertCompanyRecords(
          trx,
          "project",
          rows.map((row) => row.projectId),
          companyId,
          "Project"
        ),
      () =>
        trx
          .selectFrom("indirectPool")
          .select(["id", "name", "appliedAccountId"])
          .where("id", "in", poolIds)
          .where("companyId", "=", companyId)
          .execute()
    ]);
    if (pools.length !== poolIds.length) {
      throw new NotFoundError("Indirect pool not found");
    }
    const poolById = new Map(pools.map((pool) => [pool.id, pool]));

    // Burden catch-up is system cost: it posts to a closed project too, so
    // no assertChargeable.
    const contexts = await loadProjectPostingContexts(trx, companyId, rows);
    const contextOf = (row: (typeof rows)[number]) => {
      const context = contexts.get(
        projectPostingKey(row.projectId, row.projectElementId)
      );
      if (!context) throw new NotFoundError("Project element not found");
      return context;
    };

    // Applied burden: only the rows of Contract projects carry a journal.
    const applied = input.postApplied
      ? rows.flatMap((row, index) => {
          const context = contextOf(row);
          if (
            resolveProjectTreatment(context, input.postingDate) !== "Contract"
          ) {
            return [];
          }
          const debitAccountId = resolveProjectPostingAccount(
            context,
            input.postingDate
          ).accountId;
          const pool = poolById.get(row.indirectPoolId)!;
          if (!pool.appliedAccountId) {
            throw new ProjectChargeError(
              `Set the applied account of pool ${pool.name}.`
            );
          }
          if (!debitAccountId) return [];
          return [
            {
              index,
              row,
              debitAccountId,
              creditAccountId: pool.appliedAccountId
            }
          ];
        })
      : [];

    const debitLineIdByIndex = new Map<number, string>();
    let journalId: string | null = null;
    if (applied.length > 0) {
      journalId = await postAppliedBurdenJournal(trx, {
        companyId,
        userId,
        accountingPeriodId: period.id,
        postingDate: input.postingDate,
        indirectRateRunId: input.indirectRateRunId,
        applied,
        debitLineIdByIndex
      });
    }

    const inserted = await insertProjectLedgerRows(trx, {
      companyId,
      userId,
      rows: rows.map((row, index) => ({
        ...buildProjectLedgerRow({
          companyId,
          projectId: row.projectId,
          projectElementId: row.projectElementId,
          postingDate: input.postingDate,
          costType: "Burden",
          documentType: "Indirect Burden",
          documentId: input.indirectRateRunId,
          amount: row.amount,
          journalLineId: debitLineIdByIndex.get(index) ?? null,
          unallowable: row.unallowable,
          createdBy: userId
        }),
        indirectPoolId: row.indirectPoolId,
        indirectRateType: row.indirectRateType,
        burdenFiscalYear: row.burdenFiscalYear
      }))
    });

    return {
      success: true,
      journalId,
      projectLedgerIds: inserted.map((row) => row.id)
    };
  });
}

/**
 * One journal for the applied burden of a run: a debit line on the project
 * account and a credit line on the pool's applied account per row, each
 * signed by its account's class and tagged with the Project and
 * ProjectElement dimensions. Writes each row's debit line id into
 * `debitLineIdByIndex`. Returns the journal id.
 */
async function postAppliedBurdenJournal(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    accountingPeriodId: string;
    postingDate: string;
    indirectRateRunId: string;
    applied: {
      index: number;
      row: PostProjectBurdenInput["rows"][number];
      debitAccountId: string;
      creditAccountId: string;
    }[];
    debitLineIdByIndex: Map<number, string>;
  }
): Promise<string> {
  const { companyId, applied } = args;
  // FOR SHARE holds the status until the transaction commits.
  const status = await journalPostingStatus(trx, companyId);

  const accountIds = [
    ...new Set(
      applied.flatMap((line) => [line.debitAccountId, line.creditAccountId])
    )
  ];
  const [accounts, dimensions] = await inOrder([
    () =>
      trx
        .selectFrom("account")
        .innerJoin(
          "company",
          "company.companyGroupId",
          "account.companyGroupId"
        )
        .select(["account.id", "account.class"])
        .where("company.id", "=", companyId)
        .where("account.id", "in", accountIds)
        .execute(),
    () =>
      trx
        .selectFrom("dimension")
        .innerJoin(
          "company",
          "company.companyGroupId",
          "dimension.companyGroupId"
        )
        .select(["dimension.id", "dimension.entityType"])
        .where("company.id", "=", companyId)
        .where("dimension.active", "=", true)
        .where("dimension.entityType", "in", ["Project", "ProjectElement"])
        .execute()
  ]);
  const classById = new Map(
    accounts.map((account) => [account.id, account.class])
  );
  const accountType = (accountId: string) => {
    const accountClass = classById.get(accountId);
    if (!accountClass) throw new NotFoundError("Account not found");
    return accountTypeFromClass(accountClass);
  };

  const journalId = await createAdjustmentJournal(trx, {
    companyId,
    // A Provisional journal has no period; a Posted one takes the run's.
    accountingPeriodId: status === "Posted" ? args.accountingPeriodId : null,
    status,
    description: "Applied burden",
    postingDate: args.postingDate,
    userId: args.userId,
    sourceType: "Burden"
  });

  const lines = applied.flatMap((line) => {
    const amount = round(line.row.amount);
    return [
      {
        accountId: line.debitAccountId,
        description: "Applied burden",
        amount: debit(accountType(line.debitAccountId), amount)
      },
      {
        accountId: line.creditAccountId,
        description: "Applied burden",
        amount: credit(accountType(line.creditAccountId), amount)
      }
    ];
  });
  const lineIds = await allocateJournalLineIds(trx, lines.length);
  const journalLineReference = nanoid();
  await trx
    .insertInto("journalLine")
    .values(
      lines.map((line, i) => ({
        id: lineIds[i]!,
        journalId,
        accountId: line.accountId,
        description: line.description,
        amount: line.amount,
        quantity: 1,
        documentType: "Burden" as const,
        documentId: args.indirectRateRunId,
        documentLineReference: `burden:${args.indirectRateRunId}`,
        journalLineReference,
        companyId
      }))
    )
    .execute();

  applied.forEach((line, i) => {
    args.debitLineIdByIndex.set(line.index, lineIds[i * 2]!);
  });

  const dimensionMap = new Map<string, string>();
  for (const dimension of dimensions) {
    if (dimension.entityType) {
      dimensionMap.set(dimension.entityType, dimension.id);
    }
  }
  const tags = buildJournalLineDimensionInserts({
    journalLineIds: lineIds,
    meta: applied.flatMap((line) => {
      const meta = {
        projectId: line.row.projectId,
        projectElementId: line.row.projectElementId
      };
      return [meta, meta];
    }),
    dimensionMap,
    companyId
  });
  if (tags.length > 0) {
    await trx.insertInto("journalLineDimension").values(tags).execute();
  }

  return journalId;
}
