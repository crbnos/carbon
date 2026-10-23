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
import type {
  CarbonError,
  ServiceContext
} from "@carbon/api/service-fn.server";
import {
  assertEntitiesInStripes,
  loadDemandStripes,
  type StripeQuantity,
  splitAcrossStripes,
  trackedEntityStripe
} from "@carbon/api/stock-stripes";
import { error, hasPermission } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { getUserClaims } from "@carbon/auth/users.server";
import {
  type Database,
  getCompanyTimeZone,
  type Json,
  journalReference
} from "@carbon/database";
import type {
  KyselyDatabase as DB,
  Kysely,
  KyselyDatabase,
  KyselyTx
} from "@carbon/database/client";
import { fetchAll } from "@carbon/database/fetch-all";
import { journalPostingStatus } from "@carbon/database/journal-posting-status";
import { toJson } from "@carbon/database/json";
import { completedAtForGroup } from "@carbon/database/project-plan";
import { inOrder, rpcRows, single } from "@carbon/database/rows";
import { getStrictBackflushSettings } from "@carbon/database/strict-backflush";
import type {
  BudgetCheckInput,
  BudgetCheckResult
} from "@carbon/ee/project-control";
import {
  checkBudgetAvailability,
  checkTimesheetBudget,
  formatBudgetCheckMessage
} from "@carbon/ee/project-control.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import {
  accountTypeFromClass,
  BILLABLE_REASON_NO_BILL_RATE,
  buildJournalLineDimensionInserts,
  certificationTextFor,
  computeWbsCodes,
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
  round,
  searchFilter,
  settleQuantity,
  TIMESHEET_REFUSAL_NOT_DRAFT,
  type TimesheetEntryStatus,
  taxYearBounds,
  timecardShortfall,
  timesheetWeek,
  wbsTemplate,
  wbsTemplateParentCode
} from "@carbon/utils";
import { endOfMonth, parseDate } from "@internationalized/date";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { type Selectable, sql, type Transaction } from "kysely";
import { customAlphabet, nanoid } from "nanoid";
import { data } from "react-router";
import { z } from "zod";
import {
  getMethodTree,
  jobCreationRefusal
} from "~/modules/items/items.service";
import { claimPlanningActions } from "~/modules/production/planning-action-claims";
import { insertJob } from "~/modules/production/production.service";
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
  invokePosting,
  resolveAccountingPeriod
} from "~/modules/shared/shared.service";
import {
  type GenericQueryFilters,
  LIST_COUNT,
  setGenericQueryFilters
} from "~/utils/query";
import { ruleError, sanitize } from "~/utils/supabase";
import { updateSortOrder } from "../shared/sort-order";
import { buildProjectCipRow, writeProjectCipRows } from "./project-cip";
import { ProjectCloseError, relieveProjectWipAtClose } from "./project-close";
import { postProjectJournal } from "./project-journal";
import {
  assertChargeable,
  buildProjectLedgerRow,
  insertProjectLedgerRows,
  issueReturnUnitCost,
  isUnallowableCharge,
  loadProjectPostingContexts,
  loadReturnableIssueRows,
  ProjectChargeError,
  projectPostingKey,
  resolveProjectPostingAccount,
  resolveProjectTreatment,
  splitReceiptChargedDrafts,
  startElementsOnFirstCharge
} from "./project-posting";
import {
  applyChangeRequestItems,
  apportionedBaseRefusal,
  assertCanApprove,
  type BillableItemAction,
  BUILD_FROM_PART_MAX_NODES,
  type BuildSourceNode,
  type BuildTraceRow,
  type ChangeOperationMark,
  type ChangeRequestChange,
  type ChangeRequestConflict,
  type ChangeRequestItem,
  canLink,
  chargeableByDefault,
  computeVerification,
  diffPlanSnapshots,
  type ElementVerification,
  elementDeleteRefusal,
  elementSubtreeIds,
  findConflicts,
  governmentFurnishedRefusal,
  groupTimesheetRows,
  type ItemValues,
  isProjectPlanLocked,
  type LaborDistributionLaborRow,
  type laborCategoryRateValidator,
  type laborCategoryValidator,
  mergeChangeRequestItem,
  monthNumber,
  netBuildComponents,
  overlayPlanRows,
  PARAMETER_ITEM_UNIT_COST,
  PLAN_LAYER_FIELDS,
  type PlannedBuildElement,
  type PlanRow,
  PROJECT_BASELINE_FORMAT_VERSION,
  type ProjectBaselineSource,
  type ProjectBorrowStatus,
  type ProjectChangeOperation,
  type ProjectChangeRequestStatus,
  type ProjectCopyElement,
  type ProjectCopySource,
  type ProjectCostTreatment,
  type ProjectCostType,
  type ProjectElementEditableField,
  type ProjectElementType,
  type ProjectPlanSnapshot,
  type ProjectPlanTable,
  type ProjectStateGroup,
  type ProjectStatus,
  type ProjectStockTransferAction,
  type ProjectStockTransferType,
  parameterSources,
  parseElementPlanFieldValue,
  parseParameterFormula,
  parsePlanSnapshot,
  pickPlanLayerFields,
  planElementsFromSource,
  planProjectCopy,
  planRowParentIds,
  planSnapshotKeys,
  projectCopyIdPrefixes,
  type projectElementCostValidator,
  type projectElementLaborValidator,
  type projectElementLinkValidator,
  type projectElementMaterialValidator,
  type projectElementValidator,
  type projectExpenseValidator,
  type projectIssueValidator,
  type projectLabelValidator,
  type projectMilestoneValidator,
  projectPlanLockedMessage,
  type projectStateValidator,
  projectStockTransferActionFrom,
  type projectStockTransferLineValidator,
  type projectValidator,
  type RdActivityRole,
  type RdEmployeeYear,
  type RdLedgerRow,
  type RequirementStatus,
  rdComponentTypes,
  rdSoftwareTypes,
  readWbsCsv,
  rebaseChangeRequestItems,
  requirementCategories,
  requirementTargetOperators,
  requirementVerificationMethods,
  rollUpRequirementStatus,
  stopWorkStatusRefusal,
  suspectLinkFields,
  taxYearOf,
  testCaseVerdicts,
  toPlanSnapshot,
  typeSpecificElementFields,
  type VerificationElement,
  type WbsCsvCreate,
  type WbsCsvResult,
  type WbsElement,
  type WbsLink,
  wbsTemplateElementType,
  weekStartOf
} from "./projects.models";
import { paybackVariance, planBorrowMatching } from "./stock-transfer-plan";
import {
  type DilutionPostedEntry,
  planDilution,
  planRedilutionPostings,
  planTimesheetPosting,
  type TimesheetJournalLine,
  type TimesheetOriginal,
  type TimesheetPostingEntry
} from "./timesheet-posting-plan";
import type { ProjectElementLink } from "./types";

type Client = SupabaseClient<Database>;

/**
 * A refusal in the `{ data, error }` shape the routes already read. Its rule
 * code makes `unwrap` keep the message as written, as a `rule` refusal.
 */
function refusal(message: string) {
  return {
    data: null,
    error: ruleError(message) as unknown as PostgrestError
  };
}

/** Purchase order statuses whose lines still count as open commitments. */
const CLOSED_PURCHASE_ORDER_STATUSES = ["Completed", "Closed", "Rejected"];

/** Job statuses that no longer take charges. */
const CLOSED_JOB_STATUSES = ["Completed", "Cancelled", "Closed"];

// --- Projects ----------------------------------------------------------------

/**
 * Deactivates a project. The row stays so its history still resolves.
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
 * name of the active projects that are not templates, by
 * identifier, at most 200.
 */
export async function getProjectSwitcherOptions(
  client: Client,
  companyId: string
) {
  return client
    .from("project")
    .select("id, identifier, name")
    .eq("companyId", companyId)
    .eq("active", true)
    .eq("isTemplate", false)
    .order("identifier", { ascending: true })
    .limit(200);
}

/**
 * Lists the active projects of the company.
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
      searchFilter(["name", "identifier", "description"], args.search)
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
 */
export async function updateProjectStatus(
  client: Client,
  db: Kysely<KyselyDatabase>,
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

    return closeProject(db, {
      id: args.id,
      companyId: args.companyId,
      updatedBy: args.updatedBy
    });
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

/**
 * Closes a project in one transaction, after `updateProjectStatus` has
 * checked its open purchase order lines and jobs. Refuses while a borrow the
 * project owes or lent is not paid back, while the project holds project
 * stock, and, for Capitalize, while one of its assets is still Under
 * Construction (spec `.ai/specs/2026-10-03-projects.md` → Lifecycle). A
 * Contract project then relieves its Project WIP that no progress contract
 * line owns to cost of goods sold, dated the company's day
 * (`relieveProjectWipAtClose`, audit D11). Returns the close journal, null
 * when there was nothing to relieve.
 */
export async function closeProject(
  db: Kysely<KyselyDatabase>,
  args: { id: string; companyId: string; updatedBy: string }
): Promise<
  | { data: { id: string; journalId: string | null }; error: null }
  | ReturnType<typeof refusal>
> {
  const { companyId } = args;
  try {
    return await db.transaction().execute(async (trx) => {
      const project = await trx
        .selectFrom("project")
        .select(["id", "identifier", "costTreatment", "fixedAssetId"])
        .where("id", "=", args.id)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!project) return refusal("The project was not found");

      const refused = await projectCloseRefusal(trx, {
        companyId,
        projectId: project.id,
        costTreatment: project.costTreatment,
        fixedAssetId: project.fixedAssetId
      });
      if (refused) return refusal(refused);

      const closeDate = datetime
        .today(await getCompanyTimeZone(trx, companyId))
        .toString();
      const relief =
        project.costTreatment === "Contract"
          ? await relieveProjectWipAtClose(trx, {
              companyId,
              userId: args.updatedBy,
              projectId: project.id,
              identifier: project.identifier,
              closeDate
            })
          : null;

      await trx
        .updateTable("project")
        .set({
          status: "Closed",
          updatedBy: args.updatedBy,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", project.id)
        .where("companyId", "=", companyId)
        .execute();
      return {
        data: { id: project.id, journalId: relief?.journalId ?? null },
        error: null
      };
    });
  } catch (err) {
    if (err instanceof ProjectCloseError) return refusal(err.message);
    throw err;
  }
}

/** Why a project cannot close yet (after its open PO lines and jobs), or
 *  null. Each message says what to do. */
async function projectCloseRefusal(
  trx: KyselyTx,
  args: {
    companyId: string;
    projectId: string;
    costTreatment: ProjectCostTreatment;
    fixedAssetId: string | null;
  }
): Promise<string | null> {
  const { companyId, projectId } = args;
  const borrows = await trx
    .selectFrom("projectBorrow")
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .where("companyId", "=", companyId)
    .where("status", "=", "Open")
    .where((eb) =>
      eb.or([
        eb("borrowerProjectId", "=", projectId),
        eb("lenderProjectId", "=", projectId)
      ])
    )
    .executeTakeFirstOrThrow();
  const openBorrows = Number(borrows.count);
  if (openBorrows > 0) {
    return `The project has ${openBorrows} borrow(s) not paid back. Pay them back from the project's Stock page before you close the project.`;
  }

  const stock = await getProjectStockOnHand(trx, { companyId, projectId });
  if (stock.length > 0) {
    return `The project still holds project stock (${stock.length} item(s)). Transfer it to unassigned stock or another project before you close the project.`;
  }

  if (args.costTreatment === "Capitalize") {
    const elements = await trx
      .selectFrom("projectElement")
      .select("fixedAssetId")
      .where("companyId", "=", companyId)
      .where("projectId", "=", projectId)
      .where("fixedAssetId", "is not", null)
      .execute();
    const assetIds = [
      ...new Set(
        [args.fixedAssetId, ...elements.map((e) => e.fixedAssetId)].filter(
          (id): id is string => Boolean(id)
        )
      )
    ];
    if (assetIds.length > 0) {
      const building = await trx
        .selectFrom("fixedAsset")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("companyId", "=", companyId)
        .where("id", "in", assetIds)
        .where("status", "=", "Under Construction")
        .executeTakeFirstOrThrow();
      const underConstruction = Number(building.count);
      if (underConstruction > 0) {
        return `The project has ${underConstruction} asset(s) still under construction. Place them in service before you close the project.`;
      }
    }
  }

  return null;
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
 * Lists what a user can charge: each Released project, and each chargeable
 * element of a Released project whose state is Unstarted or Started. When
 * the company requires an element, the project-only rows are left out.
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
 * company-wide: every project uses them.
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
      query = query.or(searchFilter(["name", "readableId"], filters.search));
    }
    return query;
  });
}

/**
 * The descriptions of every element of a project, for the Reader. The list
 * query leaves them out, because a description can be large.
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
 * Lists the member projects of a planning group. Membership is shown on the
 * group, so no project can hoard the group's stock out of sight.
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
  "id, employeeId, entryDate, projectId, projectElementId, laborCategoryId, workLocationId, rdActivityRole, workLocation:location!timesheetEntry_workLocationId_fkey(id, name), hours, note, status, createdAt, submittedAt, approvedAt, rejectionNote, costRate, reversalOfId, correctionReason, postedAt, project:project!timesheetEntry_project_fkey(id, identifier, name), element:projectElement!timesheetEntry_element_fkey(id, readableId, name, isLeave), laborCategory:laborCategory!timesheetEntry_category_fkey(id, name), jobId, jobOperationId, job:job!timesheetEntry_job_fkey(id, jobId), jobOperation:jobOperation!timesheetEntry_jobOperation_fkey(id, description)" as const;

/**
 * Gets an employee's timesheet entries between two dates (inclusive), with
 * the project, element and labor category names.
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
 * The refusal of `assertCanApprove` for the first entry the approver may not
 * approve, else null. A transfer's reversal counts as part of the transfer:
 * its original is the entry a replacement corrects (`correctionOfId`).
 */
export async function timesheetApprovalRefusal(
  client: Client,
  args: { companyId: string; approverId: string; ids: string[] }
): Promise<string | null> {
  const [settings, entries] = await Promise.all([
    client
      .from("companySettings")
      .select("timekeepingControls")
      .eq("id", args.companyId)
      .single(),
    client
      .from("timesheetEntry")
      .select("id, correctionOfId, reversalOfId, createdBy")
      .eq("companyId", args.companyId)
      .in("id", args.ids)
  ]);
  if (settings.error || entries.error) {
    logger.error("Failed to load the entries to approve", {
      companyId: args.companyId,
      error: settings.error ?? entries.error
    });
    return "Failed to load the entries to approve";
  }
  const mode = settings.data.timekeepingControls;
  if (mode !== "DCAA") return null;

  const reversedIds = entries.data.flatMap((entry) =>
    entry.reversalOfId ? [entry.reversalOfId] : []
  );
  let transferredIds = new Set<string>();
  if (reversedIds.length > 0) {
    const replacements = await client
      .from("timesheetEntry")
      .select("correctionOfId")
      .eq("companyId", args.companyId)
      .in("correctionOfId", reversedIds);
    if (replacements.error) {
      logger.error("Failed to load the labor transfers", {
        companyId: args.companyId,
        error: replacements.error
      });
      return "Failed to load the entries to approve";
    }
    transferredIds = new Set(
      replacements.data.flatMap((row) =>
        row.correctionOfId ? [row.correctionOfId] : []
      )
    );
  }

  for (const entry of entries.data) {
    const correctionOfId =
      entry.correctionOfId ??
      (entry.reversalOfId && transferredIds.has(entry.reversalOfId)
        ? entry.reversalOfId
        : null);
    try {
      assertCanApprove({
        mode,
        approverId: args.approverId,
        entry: { correctionOfId, createdBy: entry.createdBy }
      });
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }
  return null;
}

/**
 * Whether `userId` is the employee's manager (`employeeJob.managerId`): who,
 * besides a user with `update: "projects"`, may open and change another
 * employee's timesheet.
 */
export async function managesEmployee(
  client: Client,
  args: { companyId: string; userId: string; employeeId: string }
): Promise<boolean> {
  const job = await client
    .from("employeeJob")
    .select("managerId")
    .eq("id", args.employeeId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (job.error) {
    logger.error("Failed to load the employee job", {
      companyId: args.companyId,
      error: job.error
    });
  }
  return job.data?.managerId === args.userId;
}

/**
 * Corrects a Posted entry: a Submitted reversal of the original hours and,
 * when `hours` is not 0, a Submitted replacement. Both carry the reason.
 * A replacement on another charge number (`projectId`, `projectElementId`)
 * or labor category is a labor transfer. The replacement names its original
 * in `correctionOfId`. In DCAA mode the correction writes one
 * `timesheetEntryRevision` on the original. Returns the reversal id, the
 * replacement id (or null) and `isTransfer`.
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
      // Shop time stays on its job and keeps its production event, so the
      // event's hours remain the sum of its entries (post-production-event).
      jobId: original.jobId,
      jobOperationId: original.jobOperationId,
      productionEventId: original.productionEventId,
      note: original.note,
      correctionReason: args.correctionReason,
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
          // Shop time belongs to the original project: a transfer to another
          // project drops its job.
          ...(movesProject
            ? {
                jobId: null,
                jobOperationId: null
              }
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

// --- Project stock transfers ---------------------------------------------------

const PROJECT_STOCK_TRANSFER_COLUMNS =
  "*, fromProject:project!projectStockTransfer_from_fkey(id, identifier, name), toProject:project!projectStockTransfer_to_fkey(id, identifier, name)";

/**
 * Lists the project stock transfers of the company, newest first. With a
 * project, only the transfers from or to it.
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
      searchFilter(["projectStockTransferId", "reason"], args.search)
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
 * The projects that keep project stock: the stock owners the
 * transfer pickers and the inventory owner filter offer, beside common stock.
 */
export async function getStockOwnerProjects(client: Client, companyId: string) {
  return client
    .from("project")
    .select("id, identifier, name, status, customerId, governmentFurnished")
    .eq("companyId", companyId)
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
 * Submits an employee's Draft entries in the ISO week that starts on
 * `weekStart`.
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
      .select([
        "timesheetEntry.id",
        "timesheetEntry.status",
        "timesheetEntry.hours"
      ])
      .where("timesheetEntry.companyId", "=", companyId)
      .where("timesheetEntry.employeeId", "=", employeeId)
      .where("timesheetEntry.entryDate", ">=", weekStart)
      .where("timesheetEntry.entryDate", "<=", weekEnd)
      .orderBy("timesheetEntry.id")
      .forUpdate("timesheetEntry")
      .execute();

    const drafts = entries.filter((entry) => entry.status === "Draft");
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
// Saves one timesheet cell, or adds one entry (Log time): the
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
 * - **`add` mode** (Log time): always inserts a new entry with the
 *   requested status, beside any entry of the same cell. DCAA
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
  input: {
    companyId: string;
    employeeId: string;
    laborCategoryId: string;
    workLocationId?: string | null;
    rdActivityRole?: RdActivityRole | null;
  }
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
  if (input.jobId !== undefined) {
    existingQuery = input.jobId
      ? existingQuery.where("jobId", "=", input.jobId)
      : existingQuery.where("jobId", "is", null);
  }
  if (input.jobOperationId !== undefined) {
    existingQuery = input.jobOperationId
      ? existingQuery.where("jobOperationId", "=", input.jobOperationId)
      : existingQuery.where("jobOperationId", "is", null);
  }
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
        jobId: input.jobId ?? null,
        jobOperationId: input.jobOperationId ?? null,
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
 * `add` mode: one new entry each call, as Phase 1a Log time did. It never replaces the hours of an entry already in the cell.
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

  const entryId = await insertTimesheetDraft(trx, {
    companyId,
    employeeId,
    entryDate: input.entryDate,
    projectId: input.projectId,
    projectElementId: input.projectElementId,
    laborCategoryId: input.laborCategoryId,
    hours: input.hours,
    jobId: input.jobId ?? null,
    jobOperationId: input.jobOperationId ?? null,
    workLocationId: input.workLocationId,
    rdActivityRole: input.rdActivityRole,
    note: input.note ?? null,
    lateReason: late ? lateReason : null,
    status,
    createdBy: userId
  });

  if (mode === "DCAA" && !actorIsOwner) {
    await writeRevision(trx, {
      companyId,
      employeeId,
      timesheetEntryId: entryId,
      revisedBy: userId,
      reason: reason!,
      before: null,
      after: revisionFields(input)
    });
  }
  return { entryId, status };
}

/**
 * Inserts one timesheet entry and runs no control: the caller has applied
 * them. `addEntry` calls it after the cell's controls; `post-production-event`
 * calls it for shop time on a consume-to-project job under DCAA (D38), whose
 * hours the shop floor recorded, so the employee certifies them with the week.
 * The entry is Draft unless `status` says otherwise. A work location or
 * research role left out takes its default (`resolveRdDefaults`).
 */
export async function insertTimesheetDraft(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    employeeId: string;
    entryDate: string;
    projectId: string;
    projectElementId: string | null;
    laborCategoryId: string;
    hours: number;
    jobId?: string | null;
    /** Shop time: the job operation and the production event it came from. */
    jobOperationId?: string | null;
    productionEventId?: string | null;
    workLocationId?: string | null;
    rdActivityRole?: RdActivityRole | null;
    note?: string | null;
    lateReason?: string | null;
    status?: TimesheetEntryStatus;
    createdBy: string;
  }
): Promise<string> {
  const defaults =
    args.workLocationId === undefined || args.rdActivityRole === undefined
      ? await resolveRdDefaults(trx, args)
      : null;
  const status = args.status ?? "Draft";
  const now = datetime.timestamp();
  const created = await trx
    .insertInto("timesheetEntry")
    .values({
      companyId: args.companyId,
      employeeId: args.employeeId,
      entryDate: args.entryDate,
      projectId: args.projectId,
      projectElementId: args.projectElementId,
      jobId: args.jobId ?? null,
      jobOperationId: args.jobOperationId ?? null,
      productionEventId: args.productionEventId ?? null,
      laborCategoryId: args.laborCategoryId,
      workLocationId:
        args.workLocationId === undefined
          ? (defaults?.workLocationId ?? null)
          : args.workLocationId,
      rdActivityRole:
        args.rdActivityRole === undefined
          ? (defaults?.rdActivityRole ?? null)
          : args.rdActivityRole,
      hours: args.hours,
      note: args.note ?? null,
      lateReason: args.lateReason ?? null,
      status,
      submittedAt: status === "Submitted" ? now : null,
      createdBy: args.createdBy,
      createdAt: now
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return created.id;
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
        jobId: input.jobId ?? null,
        jobOperationId: input.jobOperationId ?? null,
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
        "jobId",
        "hours",
        "status",
        "postedAt",
        "reversalOfId",
        "correctionOfId",
        "note"
      ])
      .where("id", "in", entryIds)
      .where("companyId", "=", companyId)
      .orderBy("id")
      .forUpdate()
      .execute();

    const entries = locked
      .filter(
        (entry) =>
          (entry.status === "Submitted" || entry.status === "Approved") &&
          entry.postedAt === null
      )
      .map((entry) => ({
        id: entry.id,
        employeeId: entry.employeeId,
        entryDate: entry.entryDate,
        projectId: entry.projectId,
        projectElementId: entry.projectElementId,
        laborCategoryId: entry.laborCategoryId,
        jobId: entry.jobId,
        hours: Number(entry.hours),
        reversalOfId: entry.reversalOfId,
        correctionOfId: entry.correctionOfId,
        note: entry.note,
        bookedRate: null as number | null
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
    // What each reversed or re-diluted entry booked, and the rate a
    // correction's original booked.
    const bookedIds = [
      ...new Set([...originalIds, ...redilutedEntries.map((e) => e.id)])
    ];
    const rateSourceIds = [
      ...new Set([
        ...originalIds,
        ...entries
          .filter((e) => !e.reversalOfId && e.correctionOfId)
          .map((e) => e.correctionOfId as string)
      ])
    ];

    const [contexts, rates, originals, originalLedger, accountDefaults] =
      await inOrder([
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
          rateSourceIds.length === 0
            ? ([] as Pick<
                Selectable<DB["timesheetEntry"]>,
                | "id"
                | "costRate"
                | "hours"
                | "dilutionFactor"
                | "laborCategoryId"
                | "jobId"
              >[])
            : trx
                .selectFrom("timesheetEntry")
                .select([
                  "id",
                  "costRate",
                  "hours",
                  "dilutionFactor",
                  "laborCategoryId",
                  "jobId"
                ])
                .where("id", "in", rateSourceIds)
                .where("companyId", "=", companyId)
                .execute(),
        () => loadTimesheetBookings(trx, companyId, bookedIds),
        () =>
          trx
            .selectFrom("accountDefault")
            .select(["laborAbsorptionAccount", "retainedEarningsAccount"])
            .where("companyId", "=", companyId)
            .executeTakeFirst()
      ]);
    if (!accountDefaults) throw new Error("Error getting account defaults");
    // Every posting writes its journal: Provisional before the company's
    // accounting cutover, Posted after it. FOR SHARE holds the status until
    // commit. A Provisional journal has no accounting period.
    const postingStatus = await journalPostingStatus(trx, companyId);
    const journalOptions = { postingStatus, accountDefaults };

    const originalById = new Map(
      originals.map((original) => [original.id, original])
    );
    // A correction's replacement on its original's labor category rebooks
    // at the rate the original booked, undiluted: a rate edited since must
    // not leave a residual in labor absorption.
    for (const entry of entries) {
      if (entry.reversalOfId || !entry.correctionOfId) continue;
      const original = originalById.get(entry.correctionOfId);
      if (
        !original ||
        original.costRate === null ||
        original.laborCategoryId !== entry.laborCategoryId
      ) {
        continue;
      }
      entry.bookedRate = round(
        Number(original.costRate) / Number(original.dilutionFactor ?? 1)
      );
    }
    const bookedById = new Map<string, TimesheetOriginal>();
    const reversedIds = new Set(originalIds);
    for (const original of originals) {
      if (!reversedIds.has(original.id)) continue;
      const booking = originalLedger.get(original.id);
      bookedById.set(original.id, {
        id: original.id,
        costRate: original.costRate === null ? null : Number(original.costRate),
        hours: Number(original.hours),
        ...(booking ?? emptyTimesheetBooking)
      });
    }
    // A re-diluted entry with no posting row posted nothing to adjust.
    for (const entry of redilutedEntries) {
      bookedById.set(entry.id, {
        id: entry.id,
        costRate: null,
        hours: entry.hours,
        ...(originalLedger.get(entry.id) ?? emptyTimesheetBooking)
      });
    }

    const plan = planTimesheetPosting(
      entries,
      contexts,
      rates.map((rate) => ({
        laborCategoryId: rate.laborCategoryId,
        effectiveFrom: rate.effectiveFrom,
        costRate: Number(rate.costRate)
      })),
      bookedById,
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
        journalOptions,
        bookedById
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
          "Employee"
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
              ["Employee", line.employeeId]
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
      // Shop time keeps its job on the ledger row, so the job's cost
      // counts it; a reversal without a job of its own takes its
      // original's.
      const originalJobById = new Map(
        originals.map((original) => [original.id, original.jobId])
      );
      const jobIdByEntry = new Map(
        [...entries, ...redilutedEntries].map((entry) => [
          entry.id,
          entry.jobId ??
            (entry.reversalOfId
              ? (originalJobById.get(entry.reversalOfId) ?? null)
              : null)
        ])
      );
      await insertProjectLedgerRows(trx, {
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
            jobId: jobIdByEntry.get(row.entryId) ?? null,
            employeeId: row.employeeId,
            laborCategoryId: row.laborCategoryId,
            quantity: row.quantity,
            unitOfMeasureCode: "HR",
            amount: row.amount,
            journalLineId: debitLineIdByEntry.get(row.entryId) ?? null,
            reversalOfId: row.reversalOfId,
            unallowable: row.unallowable,
            createdBy: userId
          })
        )
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

    // One statement for every entry: each carries its own rate and journal.
    const postedAt = datetime.timestamp();
    await sql`
        UPDATE "timesheetEntry" t
        SET "status" = 'Posted',
            "costRate" = v."costRate",
            "journalId" = v."journalId",
            "dilutionFactor" = COALESCE(v."dilutionFactor", t."dilutionFactor"),
            "postedAt" = ${postedAt}::timestamptz,
            "updatedBy" = ${userId},
            "updatedAt" = ${postedAt}::timestamptz
        FROM (VALUES ${sql.join(
          plan.stamps.map(
            (stamp) =>
              sql`(${stamp.entryId}, ${stamp.costRate}::numeric, ${
                journalIdByEntry.get(stamp.entryId) ?? null
              }::text, ${stamp.dilutionFactor ?? null}::numeric)`
          )
        )}) AS v("id", "costRate", "journalId", "dilutionFactor")
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
  note: string | null;
  /** The job of shop time under DCAA; its ledger row carries it. */
  jobId: string | null;
};

type TimesheetBooking = Pick<
  TimesheetOriginal,
  | "ledgerRowId"
  | "postedAmount"
  | "accountId"
  | "unallowable"
  | "fixedAssetId"
  | "postCapitalization"
>;

const emptyTimesheetBooking: TimesheetBooking = {
  ledgerRowId: null,
  postedAmount: 0,
  accountId: null,
  unallowable: false,
  fixedAssetId: null,
  postCapitalization: false
};

/**
 * What each posted timesheet entry booked, in 2 queries: its own posting
 * row (the earliest live row with hours: not a dilution adjustment, not a
 * reversal, not reversed), the account of that row's
 * journal debit line and its unallowable flag, the Σ of all its Timesheet
 * rows, and the asset its CIP row built. An entry with no live posting row
 * is absent.
 */
async function loadTimesheetBookings(
  trx: Transaction<DB>,
  companyId: string,
  entryIds: string[]
): Promise<Map<string, TimesheetBooking>> {
  const bookings = new Map<string, TimesheetBooking>();
  if (entryIds.length === 0) return bookings;
  const [rows, cipRows] = await inOrder([
    () =>
      trx
        .selectFrom("projectLedger")
        .leftJoin("journalLine", (join) =>
          join
            .onRef("journalLine.id", "=", "projectLedger.journalLineId")
            .onRef("journalLine.companyId", "=", "projectLedger.companyId")
        )
        .select((eb) => [
          "projectLedger.id",
          "projectLedger.documentId",
          "projectLedger.amount",
          "projectLedger.quantity",
          "projectLedger.reversalOfId",
          "projectLedger.unallowable",
          "journalLine.accountId",
          eb
            .exists(
              eb
                .selectFrom("projectLedger as reversal")
                .select("reversal.id")
                .whereRef("reversal.reversalOfId", "=", "projectLedger.id")
                .whereRef("reversal.companyId", "=", "projectLedger.companyId")
            )
            .as("reversed")
        ])
        .where("projectLedger.documentType", "=", "Timesheet")
        .where("projectLedger.documentId", "in", entryIds)
        .where("projectLedger.companyId", "=", companyId)
        .orderBy("projectLedger.createdAt")
        .orderBy("projectLedger.id")
        .execute(),
    () =>
      trx
        .selectFrom("fixedAssetCipCost")
        .select(["sourceDocumentId", "fixedAssetId", "postCapitalization"])
        .where("sourceType", "=", "Timesheet")
        .where("sourceDocumentId", "in", entryIds)
        .where("companyId", "=", companyId)
        .orderBy("createdAt")
        .execute()
  ]);

  const postedAmount = new Map<string, number>();
  for (const row of rows) {
    postedAmount.set(
      row.documentId,
      (postedAmount.get(row.documentId) ?? 0) + Number(row.amount)
    );
  }
  const cipByEntry = new Map<
    string,
    { fixedAssetId: string; postCapitalization: boolean }
  >();
  for (const row of cipRows) {
    if (row.sourceDocumentId && !cipByEntry.has(row.sourceDocumentId)) {
      cipByEntry.set(row.sourceDocumentId, row);
    }
  }
  for (const row of rows) {
    if (bookings.has(row.documentId)) continue;
    // A dilution adjustment (0 hours) changes the cost, never the posting.
    if (row.reversalOfId || row.reversed || Number(row.quantity) === 0) {
      continue;
    }
    const cip = cipByEntry.get(row.documentId);
    bookings.set(row.documentId, {
      ledgerRowId: row.id,
      postedAmount: round(postedAmount.get(row.documentId) ?? 0),
      accountId: row.accountId ?? null,
      unallowable: row.unallowable,
      fixedAssetId: cip?.fixedAssetId ?? null,
      postCapitalization: cip?.postCapitalization ?? false
    });
  }
  return bookings;
}

/**
 * The dilution of every (exempt employee, ISO week) the call touches, in DCAA
 * mode, in at most 3 queries: the employees' FLSA status, the weeks'
 * entries, and what each posted entry's ledger rows hold.
 * - The week's hours are its Submitted, Approved and Posted entries plus the
 *   entries of this call.
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
    .select([
      "timesheetEntry.id",
      "timesheetEntry.employeeId",
      "timesheetEntry.entryDate",
      "timesheetEntry.projectId",
      "timesheetEntry.projectElementId",
      "timesheetEntry.laborCategoryId",
      "timesheetEntry.jobId",
      "timesheetEntry.hours",
      "timesheetEntry.status",
      "timesheetEntry.costRate",
      "timesheetEntry.dilutionFactor",
      "timesheetEntry.reversalOfId",
      "timesheetEntry.note"
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
      jobId: row.jobId,
      hours: Number(row.hours),
      reversalOfId: null,
      note: row.note
    })),
    adjustments,
    stamps
  };
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
 * A reversal entry (`reversalOfId`) posts its own (negative) amount to the
 * account its original booked. Posting twice is a no-op.
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

    // The original's open ledger row: not reversed by a later row, with the
    // account of its journal debit line and its unallowable flag.
    const original = entry.reversalOfId
      ? await sql<{
          id: string;
          unallowable: boolean;
          accountId: string | null;
        }>`
            SELECT pl."id", pl."unallowable", jl."accountId"
            FROM "projectLedger" pl
            LEFT JOIN "journalLine" jl
              ON jl."id" = pl."journalLineId" AND jl."companyId" = pl."companyId"
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

    // A reversal undoes what its original booked: the account its debit
    // line was on, whatever the project's treatment is today.
    const resolved = original?.accountId
      ? {
          treatment: resolveProjectTreatment(context, entry.entryDate),
          accountId: original.accountId
        }
      : resolveProjectPostingAccount(context, entry.entryDate);
    if (!original?.accountId && resolved.treatment === "Capitalize") {
      throw new ProjectChargeError(
        "An expense entry cannot charge a capital project. Use a charge or a purchase invoice."
      );
    }
    const isStatistical =
      !original?.accountId && resolved.treatment === "Statistical";
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
            description: isStatistical ? "Indirect Cost" : "Project Expense",
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
          ["Employee", entry.employeeId]
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
              // A reversal copies its original's flag.
              unallowable:
                original?.unallowable ??
                isUnallowableCharge(context, resolved.accountId),
              createdBy: userId
            })
          ]
        })
      )[0]!;
      projectLedgerId = row.id;
    }

    await trx
      .updateTable("projectExpenseEntry")
      .set({
        journalId,
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
  direction: z.enum(["Issue", "Return"])
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
 * projectLedger Material row records the same cost, except for units its
 * receipts already charged (Charge at receipt): those write a zero-net
 * relocation pair (`splitReceiptChargedDrafts`). A Statistical project
 * charges indirectCostAccount and writes no ledger row.
 *
 * A Return values the stock at the cost the issues it reverses charged
 * (`issueReturnUnitCost`: net outstanding issue cost over quantity, the
 * Unscrap rule), else at the item's current cost, and the ledger row uses
 * that same cost, so the project total equals the GL and a round trip nets
 * to 0.
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
          {
            columns: [
              "name",
              "readableIdWithRevision",
              "itemTrackingType",
              "replenishmentSystem"
            ]
          }
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

  const itemLabel =
    itemResult.data.readableIdWithRevision ??
    itemResult.data.name ??
    "The item";
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
    // A serial or batch is one real unit: it never goes below zero.
    if (round(quantity) > round(source?.quantity ?? 0)) {
      throw new InvalidInputError(
        `${itemLabel} has ${round(source?.quantity ?? 0)} of this ${
          itemResult.data.itemTrackingType === "Serial" ? "serial" : "batch"
        } on hand, not ${quantity}`
      );
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
      // Short stock goes below zero, unless the company prevents negative
      // stock (Settings → Items: Strict backflush with Prevent negative
      // stock on).
      const { strict, preventNegative } = await getStrictBackflushSettings(
        db,
        companyId
      );
      if (strict && preventNegative) {
        const onHand = round(
          available.reduce((sum, stripe) => sum + stripe.quantity, 0)
        );
        throw new InvalidInputError(
          `${itemLabel} has ${onHand} on hand ${
            storageUnitId ? "in this storage unit" : "outside a storage unit"
          }, not ${quantity}. Prevent negative stock is on.`
        );
      }
    }
    // One stripe (no project stock) books the quantity as given; with
    // several, what no stripe covers comes out of the first one.
    if (stripes.length === 1) {
      draws = [{ stripe: stripes[0] ?? null, quantity }];
    } else {
      draws = split.draws.map((draw) => ({ ...draw }));
      const shortfall = round(split.remaining);
      if (shortfall > 0) {
        const first = stripes[0] ?? null;
        const own = draws.find((draw) => draw.stripe === first);
        if (own) own.quantity += shortfall;
        else draws.unshift({ stripe: first, quantity: shortfall });
      }
    }
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

    const resolved = resolveProjectPostingAccount(context, postingDate);
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

    // A Return books at the cost the issues it reverses charged (C3), so an
    // issue and its return net to 0 in the project and in WIP. With no
    // outstanding issue (a Statistical project writes no ledger row) it
    // books at the item's current cost.
    const returnUnitCost = isIssue
      ? null
      : issueReturnUnitCost(
          await loadReturnableIssueRows(trx, {
            companyId,
            projectId,
            projectElementId,
            itemId,
            trackedEntityId
          })
        );

    // One adjustment per stripe drawn; the project is charged their sum.
    const bookedRows: {
      itemLedgerId: string;
      offsetJournalLineId: string | null;
      inventoryJournalLineId: string | null;
      cost: number;
      stripe: string | null;
      quantity: number;
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
        fixedUnitCost: returnUnitCost ?? undefined,
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
              : [])
          ]
        }
      });
      bookedRows.push({
        ...bookedRow,
        stripe: draw.stripe,
        quantity: draw.quantity
      });
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
    // A unit with no cost would charge the project nothing: the item needs a
    // cost first. The throw rolls the whole issue back.
    if (isIssue && booked.cost <= 0) {
      throw new InvalidInputError(
        `${itemLabel} has no cost. Set its unit cost before you issue it.`
      );
    }

    let projectLedgerId: string | null = null;
    if (!isStatistical) {
      const ordinary = buildProjectLedgerRow({
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
        unallowable: isUnallowableCharge(context, accountId),
        createdBy: userId
      });
      // Charge at receipt (C2): the units of the project's own stock its
      // receipts charged write a zero-net relocation pair, per stripe drawn;
      // what is left of every stripe stays one ordinary row.
      const split = await splitReceiptChargedDrafts(trx, {
        companyId,
        drafts: bookedRows.map((booking) => ({
          row: {
            ...ordinary,
            quantity: isIssue ? booking.quantity : -booking.quantity,
            amount: isIssue ? booking.cost : -booking.cost,
            journalLineId: booking.offsetJournalLineId
          },
          stripeProjectId: booking.stripe,
          inventoryJournalLineId: booking.inventoryJournalLineId
        }))
      });
      const relocations = split.filter((row) => row.relocatesReceiptCharge);
      const rest = split.filter((row) => !row.relocatesReceiptCharge);
      const rows =
        relocations.length === 0
          ? [ordinary]
          : [
              ...relocations,
              ...(rest.length === 0
                ? []
                : [
                    {
                      ...ordinary,
                      quantity: round(
                        rest.reduce((sum, row) => sum + Number(row.quantity), 0)
                      ),
                      amount: round(
                        rest.reduce((sum, row) => sum + Number(row.amount), 0)
                      ),
                      journalLineId:
                        rest.find((row) => row.journalLineId)?.journalLineId ??
                        null
                    }
                  ])
            ];
      const inserted = await insertProjectLedgerRows(trx, {
        companyId,
        userId,
        rows
      });
      // The ordinary row when there is one, else the project side of the
      // relocation.
      const row =
        inserted.find((r) => !r.relocatesReceiptCharge) ?? inserted[0]!;
      projectLedgerId = row.id;

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

/**
 * Creates a project in one transaction (with a WBS template's elements when
 * one is given). States are company-wide (Settings → Projects), so none are
 * seeded. A new project starts in Draft, so nothing can charge it before it
 * is released.
 * When `identifier` is empty, the SQL function `derive_project_identifier`
 * picks a unique one from the name.
 */
export async function createProject(
  db: Kysely<KyselyDatabase>,
  args: Omit<z.infer<typeof projectValidator>, "id"> & {
    companyId: string;
    userId: string;
    /** A MIL-STD-881F template key (`WBS_TEMPLATES`) to start the plan from. */
    wbsTemplateKey?: string;
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
        projectStock: args.projectStock ?? false,
        chargeAtReceipt: args.chargeAtReceipt ?? false,
        governmentFurnished: args.governmentFurnished ?? false,
        costObjective: args.costObjective ?? null,
        restrictCharging: args.restrictCharging ?? false,
        active: true,
        companyId: args.companyId,
        createdBy: args.userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    if (args.wbsTemplateKey) {
      await insertElementsFromWbsTemplate(trx, {
        companyId: args.companyId,
        userId: args.userId,
        projectId: project.id,
        templateKey: args.wbsTemplateKey
      });
    }

    // States are company-wide (Settings → Projects): nothing to seed here.
    return project.id;
  });
}

/**
 * Inserts a MIL-STD-881F template's elements into a project with no elements,
 * every code pinned to the template's. A row with children is a System, a
 * leaf a Task. Takes one readable id per row from `nextElementSequence`.
 */
export async function insertElementsFromWbsTemplate(
  trx: KyselyTx,
  args: {
    companyId: string;
    userId: string;
    projectId: string;
    templateKey: string;
  }
) {
  const template = wbsTemplate(args.templateKey);
  if (!template) throw new Error("The WBS template does not exist");

  const state = await trx
    .selectFrom("projectState")
    .select("id")
    .where("companyId", "=", args.companyId)
    .where("group", "=", "Unstarted")
    .orderBy("isDefault", "desc")
    .orderBy("sortOrder", "asc")
    .limit(1)
    .executeTakeFirst();
  if (!state) {
    throw new Error("The company has no Unstarted state (Settings → Projects)");
  }

  const project = await trx
    .updateTable("project")
    .set({
      nextElementSequence: sql`"nextElementSequence" + ${template.rows.length}`,
      // A project made without an identifier gets one, as for a new element.
      identifier: sql<string>`COALESCE("identifier", derive_project_identifier("name", ${args.companyId}))`
    })
    .where("id", "=", args.projectId)
    .where("companyId", "=", args.companyId)
    .returning([
      sql<number>`"nextElementSequence" - ${template.rows.length}`.as(
        "firstSequence"
      ),
      "identifier"
    ])
    .executeTakeFirst();
  if (!project?.identifier) throw new Error("The project does not exist");

  const idByCode = new Map<string, string>();
  const siblingCount = new Map<string | null, number>();
  const rows = template.rows.map((row, index) => {
    const id = makeCopyId("pje");
    idByCode.set(row.code, id);
    const parentCode = wbsTemplateParentCode(row.code, template.rows);
    const parentId = parentCode ? (idByCode.get(parentCode) ?? null) : null;
    const sortOrder = (siblingCount.get(parentId) ?? 0) + 1;
    siblingCount.set(parentId, sortOrder);
    const sequence = Number(project.firstSequence) + index;
    const type = wbsTemplateElementType(row.code, template.rows);
    return {
      id,
      companyId: args.companyId,
      projectId: args.projectId,
      parentId,
      sequence,
      readableId: `${project.identifier}-${sequence}`,
      type,
      name: row.name,
      wbsCode: row.code,
      stateId: state.id,
      isChargeable: chargeableByDefault[type],
      sortOrder,
      createdBy: args.userId
    };
  });

  await trx.insertInto("projectElement").values(rows).execute();
}

/** A project's elements and `precedes` links as the WBS exports read them. */
export async function loadWbsElements(
  db: Kysely<KyselyDatabase> | KyselyTx,
  args: { companyId: string; projectId: string }
): Promise<{ elements: WbsElement[]; links: WbsLink[] }> {
  const [elements, links] = await Promise.all([
    db
      .selectFrom("projectElement")
      .select([
        "id",
        "readableId",
        "parentId",
        "type",
        "name",
        "sortOrder",
        "sequence",
        "wbsCode",
        "startDate",
        "targetDate",
        "budget"
      ])
      .where("projectId", "=", args.projectId)
      .where("companyId", "=", args.companyId)
      .execute(),
    db
      .selectFrom("projectElementLink")
      .select(["fromElementId", "toElementId"])
      .where("projectId", "=", args.projectId)
      .where("companyId", "=", args.companyId)
      .where("linkType", "=", "precedes")
      .execute()
  ]);
  return {
    elements: elements.map((element) => ({
      ...element,
      sortOrder: Number(element.sortOrder),
      budget: element.budget === null ? null : Number(element.budget)
    })),
    links
  };
}

export type WbsImportResult =
  | { applied: false; result: WbsCsvResult }
  | {
      applied: true;
      result: WbsCsvResult;
      created: number;
      updated: number;
      linked: number;
    };

/**
 * Applies a WBS CSV to a project in one transaction: creates (parents first,
 * each after its last sibling), updates, then the new `precedes` links.
 * Writes nothing when any row has an error. Never deletes.
 */
export async function importProjectWbs(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    projectId: string;
    rows: Record<string, string | undefined>[];
    apply: boolean;
  }
): Promise<WbsImportResult> {
  return db.transaction().execute(async (trx) => {
    const project = await trx
      .selectFrom("project")
      .select(["identifier"])
      .where("id", "=", args.projectId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!project) throw new Error("The project does not exist");

    const { elements, links } = await loadWbsElements(trx, args);
    const result = readWbsCsv(args.rows, elements, links);
    if (!args.apply || result.errors.length > 0) {
      return { applied: false, result };
    }

    const state = await trx
      .selectFrom("projectState")
      .select("id")
      .where("companyId", "=", args.companyId)
      .where("group", "=", "Unstarted")
      .orderBy("isDefault", "desc")
      .orderBy("sortOrder", "asc")
      .limit(1)
      .executeTakeFirst();
    if (!state) {
      throw new Error(
        "The company has no Unstarted state (Settings → Projects)"
      );
    }

    // Keys of new rows become real ids up front, so a child can name a
    // parent made in the same import.
    const idOf = new Map<string, string>(
      result.creates.map((create) => [create.key, makeCopyId("pje")])
    );
    const resolve = (key: string | null) =>
      key === null ? null : (idOf.get(key) ?? key);

    const lastSort = new Map<string | null, number>();
    for (const element of elements) {
      const current = lastSort.get(element.parentId) ?? 0;
      lastSort.set(element.parentId, Math.max(current, element.sortOrder));
    }
    const nextSort = (parentId: string | null) => {
      const value = (lastSort.get(parentId) ?? 0) + 1;
      lastSort.set(parentId, value);
      return value;
    };

    // A code can move between elements in one file (a swap, or a code a new
    // row takes over). The unique index checks row by row, so clear every
    // changing code first; the writes below set the new ones.
    const codeOf = new Map(
      elements.map((element) => [element.id, element.wbsCode])
    );
    const recoded = result.updates
      .filter((update) => update.wbsCode !== codeOf.get(update.id))
      .map((update) => update.id);
    if (recoded.length > 0) {
      await trx
        .updateTable("projectElement")
        .set({ wbsCode: null })
        .where("id", "in", recoded)
        .where("projectId", "=", args.projectId)
        .where("companyId", "=", args.companyId)
        .execute();
    }

    if (result.creates.length > 0) {
      const sequence = await trx
        .updateTable("project")
        .set({
          nextElementSequence: sql`"nextElementSequence" + ${result.creates.length}`,
          // A project made without an identifier gets one, as for a new element.
          identifier: sql<string>`COALESCE("identifier", derive_project_identifier("name", ${args.companyId}))`
        })
        .where("id", "=", args.projectId)
        .where("companyId", "=", args.companyId)
        .returning([
          sql<number>`"nextElementSequence" - ${result.creates.length}`.as(
            "first"
          ),
          "identifier"
        ])
        .executeTakeFirstOrThrow();

      // Parents before children: a create's parent may be another create.
      const createByKey = new Map(result.creates.map((c) => [c.key, c]));
      const depthOf = (create: WbsCsvCreate): number => {
        let depth = 0;
        let parent = create.parentKey
          ? createByKey.get(create.parentKey)
          : undefined;
        while (parent) {
          depth += 1;
          // readWbsCsv refuses a loop; this keeps a missed one from hanging.
          if (depth > createByKey.size) {
            throw new Error("The new rows' parents make a loop");
          }
          parent = parent.parentKey
            ? createByKey.get(parent.parentKey)
            : undefined;
        }
        return depth;
      };
      const ordered = [...result.creates].sort(
        (a, b) => depthOf(a) - depthOf(b) || a.row - b.row
      );
      const rows = ordered.map((create, index) => {
        const parentId = resolve(create.parentKey);
        const seq = Number(sequence.first) + index;
        return {
          id: idOf.get(create.key)!,
          companyId: args.companyId,
          projectId: args.projectId,
          parentId,
          sequence: seq,
          readableId: `${sequence.identifier}-${seq}`,
          type: create.type,
          name: create.name,
          wbsCode: create.wbsCode,
          startDate: create.startDate,
          targetDate: create.targetDate,
          budget: create.budget,
          stateId: state.id,
          isChargeable: chargeableByDefault[create.type],
          sortOrder: nextSort(parentId),
          createdBy: args.userId
        };
      });
      await trx.insertInto("projectElement").values(rows).execute();
    }

    if (result.updates.length > 0) {
      const sortOrderOf = new Map(
        elements.map((element) => [element.id, element.sortOrder])
      );
      const values = sql.join(
        result.updates.map((update) => {
          const parentId = resolve(update.parentKey);
          const sortOrder = update.parentChanged
            ? nextSort(parentId)
            : (sortOrderOf.get(update.id) ?? 0);
          return sql`(${update.id}, ${parentId}, ${update.type}, ${update.name}, ${update.wbsCode}, ${update.startDate}, ${update.targetDate}, ${update.budget}, ${sortOrder})`;
        })
      );
      await sql`
        UPDATE "projectElement" AS e
        SET "parentId" = v."parentId",
            "type" = v."type"::"projectElementType",
            "name" = v."name",
            "wbsCode" = v."wbsCode",
            "startDate" = v."startDate"::date,
            "targetDate" = v."targetDate"::date,
            "budget" = v."budget"::numeric,
            "sortOrder" = v."sortOrder"::numeric,
            "updatedBy" = ${args.userId},
            "updatedAt" = ${datetime.timestamp()}
        FROM (VALUES ${values}) AS v("id", "parentId", "type", "name", "wbsCode", "startDate", "targetDate", "budget", "sortOrder")
        WHERE e."id" = v."id"
          AND e."projectId" = ${args.projectId}
          AND e."companyId" = ${args.companyId}
      `.execute(trx);
    }

    if (result.links.length > 0) {
      await trx
        .insertInto("projectElementLink")
        .values(
          result.links.map((link) => ({
            id: makeCopyId("pjk"),
            companyId: args.companyId,
            projectId: args.projectId,
            fromElementId: resolve(link.fromKey)!,
            toElementId: resolve(link.toKey)!,
            linkType: "precedes" as const,
            createdBy: args.userId
          }))
        )
        .execute();
    }

    return {
      applied: true,
      result,
      created: result.creates.length,
      updated: result.updates.length,
      linked: result.links.length
    };
  });
}

/**
 * Pins every derived WBS code of a project, as a contractor does at award:
 * afterwards a move keeps each element's code. Refuses while 2 elements have
 * the same code.
 */
export async function pinProjectWbsCodes(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; userId: string; projectId: string }
): Promise<number> {
  return db.transaction().execute(async (trx) => {
    const nodes = await trx
      .selectFrom("projectElement")
      .select(["id", "parentId", "type", "sortOrder", "sequence", "wbsCode"])
      .where("projectId", "=", args.projectId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .execute();
    const { codes, duplicates } = computeWbsCodes(
      nodes.map((node) => ({ ...node, sortOrder: Number(node.sortOrder) }))
    );
    if (duplicates.size > 0) {
      throw new Error(
        `Duplicate WBS codes: ${[...duplicates].join(", ")}. Change one of each pair first.`
      );
    }

    const derived = nodes
      .filter((node) => node.wbsCode === null && codes.has(node.id))
      .map((node) => ({ id: node.id, code: codes.get(node.id)! }));
    if (derived.length === 0) return 0;

    const values = sql.join(
      derived.map((row) => sql`(${row.id}, ${row.code})`)
    );
    await sql`
      UPDATE "projectElement" AS e
      SET "wbsCode" = v.code,
          "updatedBy" = ${args.userId},
          "updatedAt" = ${datetime.timestamp()}
      FROM (VALUES ${values}) AS v(id, code)
      WHERE e."id" = v.id
        AND e."projectId" = ${args.projectId}
        AND e."companyId" = ${args.companyId}
    `.execute(trx);
    return derived.length;
  });
}

/**
 * Clears the pinned WBS codes of an element and its descendants, so the
 * subtree derives its codes from the tree again.
 */
export async function renumberWbsSubtree(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    projectId: string;
    elementId: string;
  }
): Promise<number> {
  const result = await sql<{ id: string }>`
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
    UPDATE "projectElement"
    SET "wbsCode" = NULL,
        "updatedBy" = ${args.userId},
        "updatedAt" = ${datetime.timestamp()}
    WHERE "id" IN (SELECT "id" FROM subtree)
      AND "companyId" = ${args.companyId}
      AND "wbsCode" IS NOT NULL
    RETURNING "id"
  `.execute(db);
  return result.rows.length;
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
 * one transaction: its milestones, elements (renumbered from 1), element
 * labels, links and plan lines. States and labels are company-wide, so the
 * copy keeps the source's. Charges, ledger rows, timesheets,
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
        .selectFrom(table as "projectMilestone")
        .selectAll()
        .where("projectId", "=", sourceProjectId)
        .where("companyId", "=", companyId)
        .execute();

    const [
      milestones,
      elements,
      links,
      materials,
      labor,
      costs,
      elementLabels,
      identifierRow
    ] = await Promise.all([
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
        projectStock: args.projectStock ?? false,
        chargeAtReceipt: args.chargeAtReceipt ?? false,
        governmentFurnished: args.governmentFurnished ?? false,
        costObjective: args.costObjective ?? null,
        restrictCharging: args.restrictCharging ?? false,
        nextElementSequence: plan.nextElementSequence,
        active: true,
        companyId,
        createdBy: userId
      })
      .execute();

    // FK order: milestones before the elements that point at them; elements
    // (parents first) before labels, links and plan lines. Every row of one
    // insert has the same keys.
    const audit = { companyId, createdBy: userId };
    const insertRows = async (table: string, rows: object[]) => {
      if (rows.length === 0) return;
      await trx
        .insertInto(table as "projectMilestone")
        .values(rows.map((row) => ({ ...row, ...audit })) as never)
        .execute();
    };
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
 * table, each reading only its `PLAN_LAYER_FIELDS`. The element query also
 * reads `startDate` and `targetDate` for the snapshot's `schedule`.
 */
export async function loadPlanSnapshot(
  db: Kysely<KyselyDatabase> | KyselyTx,
  args: { companyId: string; projectId: string }
): Promise<ProjectPlanSnapshot> {
  const ofProject = (table: ProjectPlanTable) =>
    db
      .selectFrom(table as "projectElement")
      .select(
        (table === "projectElement"
          ? [...PLAN_LAYER_FIELDS[table], "startDate", "targetDate"]
          : PLAN_LAYER_FIELDS[table]) as never
      )
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
 * takes the default Unstarted state, as `insertProjectElement` does. Labels
 * are not plan-layer, so a change request takes none: the modal hides them.
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
      .where("companyId", "=", args.companyId)
      .where("group", "=", "Unstarted")
      .orderBy("isDefault", "desc")
      .orderBy("sortOrder", "asc")
      .limit(1)
      .executeTakeFirst();
    if (!state)
      throw new ProjectChangeRequestError(
        "The company has no Unstarted state (Settings → Projects)"
      );
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
          itemId: element.itemId ?? null,
          description: element.description
            ? JSON.parse(element.description)
            : null
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

/**
 * Why a plan line of `projectId` cannot change, or null: the project does not
 * load or is Closed, or its plan is locked and the write does not go into a
 * Draft change request of the project (`requireProjectPlanEditable`).
 */
export async function planLineWriteRefusal(
  ctx: ServiceContext,
  args: { projectId: string; changeRequestId: string | null }
): Promise<CarbonError | null> {
  const project = await getProject(
    ctx.asCaller.supabase,
    ctx.company.id,
    args.projectId
  );
  if (project.error || !project.data) {
    return ctx.error("internal", "Failed to load the project", project.error);
  }
  if (project.data.status === "Closed") {
    return ctx.error("rule", "A Closed project cannot change");
  }
  const locked = await requireProjectPlanEditable(ctx.asCaller.supabase, {
    projectId: args.projectId,
    companyId: ctx.company.id,
    changeRequestId: args.changeRequestId
  });
  return locked ? ctx.error("rule", locked) : null;
}

/**
 * A plan line write in change request `changeRequestId`: an add or update
 * with `fields`, or (`remove`) a delete. Returns the line's id, or the change
 * request's refusal (`ProjectChangeRequestError`) as `rule`. Another failure
 * keeps its message, or `fallback`.
 */
export async function stagePlanLineChange(
  ctx: ServiceContext,
  args: { projectId: string; changeRequestId: string; table: PlanLineTable } & (
    | { id?: string; elementId: string; fields: Record<string, unknown> }
    | { id: string; remove: true }
  ),
  fallback: string
): Promise<{ id: string } | CarbonError> {
  const write = {
    companyId: ctx.company.id,
    userId: ctx.auditUserId,
    projectId: args.projectId,
    changeRequestId: args.changeRequestId
  };
  try {
    if ("remove" in args) {
      await deletePlanLineInChangeRequest(ctx.asSystem.pg, {
        ...write,
        table: args.table,
        id: args.id
      });
      return { id: args.id };
    }
    return await upsertPlanLineInChangeRequest(ctx.asSystem.pg, {
      ...write,
      table: args.table,
      id: args.id,
      elementId: args.elementId,
      fields: args.fields
    });
  } catch (err) {
    if (err instanceof ProjectChangeRequestError) {
      return ctx.error("rule", err.message);
    }
    return ctx.error(
      "internal",
      err instanceof Error ? err.message : fallback,
      err
    );
  }
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
      `The current plan changed under ${conflicts.length} row(s) of the change request`
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
      // Refuse a delete that removes the base of an Apportioned element
      // outside the deleted subtrees (its CHECK refuses the FK's SET NULL).
      const projectElements = await trx
        .selectFrom("projectElement")
        .select([
          "id",
          "parentId",
          "readableId",
          "name",
          "earnedValueTechnique",
          "apportionedToElementId"
        ])
        .where("projectId", "=", projectId)
        .where("companyId", "=", args.companyId)
        .execute();
      const apportioned = apportionedBaseRefusal(
        deleted.flatMap((id) => elementSubtreeIds(projectElements, id)),
        projectElements
      );
      if (apportioned) throw new ProjectChangeRequestError(apportioned);

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
        UNION ALL
        SELECT s."readableId", 'earned value' FROM subtree s
          WHERE EXISTS (SELECT 1 FROM "earnedValuePeriod" v
            WHERE (v."projectElementId" = s."id" OR v."controlAccountId" = s."id")
              AND v."companyId" = ${args.companyId})
        LIMIT 1
      `.execute(trx);
      const first = charged.rows[0];
      if (first) {
        throw new ProjectChangeRequestError(
          first.source === "earned value"
            ? `${first.readableId} has earned value recorded. The change request cannot delete it.`
            : `${first.readableId} has ${first.source} charged to it. The change request cannot delete it.`
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
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    projectId: string;
    changeRequestId: string;
    userId: string;
  }
) {
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

/** How many items a change request holds (a head-only count). */
export async function countChangeRequestItems(
  client: Client,
  changeRequestId: string,
  companyId: string
) {
  return client
    .from("projectChangeRequestItem")
    .select("id", { count: "exact", head: true })
    .eq("changeRequestId", changeRequestId)
    .eq("companyId", companyId);
}

/**
 * Adds a comment to a change request: on the change request, an element or
 * one changed field. A field needs a row; a row needs a table.
 */
export async function insertProjectChangeRequestComment(
  client: Client,
  args: {
    companyId: string;
    userId: string;
    changeRequestId: string;
    comment: string;
    targetTable?: ProjectPlanTable | null;
    targetId?: string | null;
    field?: string | null;
  }
) {
  const { targetTable, targetId, field } = args;
  return client.from("projectChangeRequestComment").insert({
    changeRequestId: args.changeRequestId,
    companyId: args.companyId,
    comment: args.comment,
    targetTable: targetTable ?? null,
    targetId: targetTable ? (targetId ?? null) : null,
    field: targetTable && targetId ? (field ?? null) : null,
    createdBy: args.userId
  });
}

/**
 * Marks a comment of a change request resolved. RLS lets only the author
 * update the row and any reviewer may resolve one, so this runs over Kysely.
 * False when the comment is not one of the change request.
 */
export async function resolveProjectChangeRequestComment(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    changeRequestId: string;
    id: string;
  }
) {
  const resolved = await db
    .updateTable("projectChangeRequestComment")
    .set({
      resolvedAt: datetime.timestamp(),
      resolvedBy: args.userId,
      updatedBy: args.userId,
      updatedAt: datetime.timestamp()
    })
    .where("id", "=", args.id)
    .where("changeRequestId", "=", args.changeRequestId)
    .where("companyId", "=", args.companyId)
    .returning("id")
    .executeTakeFirst();
  return Boolean(resolved);
}

/** Deletes the user's own comment of a change request. */
export async function deleteProjectChangeRequestComment(
  client: Client,
  args: {
    companyId: string;
    userId: string;
    changeRequestId: string;
    id: string;
  }
) {
  return client
    .from("projectChangeRequestComment")
    .delete()
    .eq("id", args.id)
    .eq("changeRequestId", args.changeRequestId)
    .eq("companyId", args.companyId)
    .eq("createdBy", args.userId);
}

/** Marks one changed row of a change request viewed by the user, or clears the mark. */
export async function setProjectChangeRequestView(
  client: Client,
  args: {
    companyId: string;
    userId: string;
    changeRequestId: string;
    targetTable: ProjectPlanTable;
    targetId: string;
    viewed: boolean;
  }
) {
  const { viewed, ...key } = args;
  if (viewed) {
    return client
      .from("projectChangeRequestView")
      .upsert({ ...key, viewedAt: datetime.timestamp() });
  }
  return client
    .from("projectChangeRequestView")
    .delete()
    .eq("changeRequestId", key.changeRequestId)
    .eq("targetTable", key.targetTable)
    .eq("targetId", key.targetId)
    .eq("userId", key.userId)
    .eq("companyId", key.companyId);
}

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
 * A job for a part, charged to a project element: the one path behind a plan
 * line's Create Job and a CLIN's Build (spec section 10). An Expense or
 * Contract project consumes the job; a Capitalize project builds the
 * element's asset under construction. A prototype job always consumes to the
 * project, whatever the CLIN's billing method (D30, D33), so the user sets no
 * flag. With no `materialId` it adds the element's Make to Order plan line
 * first, which the job then reports to; that refuses on a locked plan. The
 * job and the plan line cannot share a transaction (`insertJob` writes
 * through its own client), so a failed job deletes the plan line it added.
 */
export async function createProjectJob(
  ctx: ServiceContext,
  args: {
    projectId: string;
    elementId: string;
    itemId: string;
    quantity: number;
    dueDate?: string | null;
    locationId: string;
    /** The plan line the job builds; omitted, a plan line is added. */
    materialId?: string | null;
    /** The plan line's unit; the item's when omitted. */
    unitOfMeasureCode?: string | null;
    /** The CLIN whose part the job builds. */
    customerContractLineId?: string | null;
  }
): Promise<CarbonError | { jobId: string }> {
  const { projectId, elementId } = args;
  const companyId = ctx.company.id;
  const serviceRole = ctx.asSystem.supabase;
  const db = ctx.asSystem.pg;

  const item = await serviceRole
    .from("item")
    .select("id, unitOfMeasureCode")
    .eq("id", args.itemId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (item.error || !item.data) {
    return ctx.error("notFound", "The part could not be found", item.error);
  }

  const target = await getJobChargeTarget(db, {
    companyId,
    projectId,
    projectElementId: elementId
  });
  if (!target) return ctx.error("notFound", "The project does not exist");
  const isCapital = target.costTreatment === "Capitalize";
  if (isCapital && !target.fixedAssetId) {
    return ctx.error(
      "rule",
      "Release the project first: its assets under construction are created on release"
    );
  }
  const consumeToProject =
    target.costTreatment === "Expense" || target.costTreatment === "Contract";
  const fixedAssetId = isCapital ? target.fixedAssetId : null;

  // The job is written with the service role: the location must be this
  // company's, no unreleased change notice may hold the item, and a Make to
  // Asset item must be able to complete to its asset.
  const refusal = await jobCreationRefusal(ctx, {
    itemId: args.itemId,
    quantity: args.quantity,
    locationId: args.locationId,
    fixedAssetId
  });
  if (refusal) return refusal;

  const chargeError = await chargeNumberError(serviceRole, companyId, {
    projectId,
    projectElementId: elementId,
    consumeToProject
  });
  if (chargeError) return ctx.error("validation", chargeError.message);

  // Build adds the plan line the job reports to. The service role: making a
  // job needs no right to edit the plan, but a locked plan still refuses.
  let materialId = args.materialId ?? null;
  let addedMaterialId: string | null = null;
  if (!materialId) {
    const locked = await requireProjectPlanEditable(serviceRole, {
      projectId,
      companyId,
      changeRequestId: null
    });
    if (locked) return ctx.error("rule", locked);
    const cost = await serviceRole
      .from("itemCost")
      .select("unitCost")
      .eq("itemId", args.itemId)
      .eq("companyId", companyId)
      .maybeSingle();
    const line = await upsertProjectElementMaterial(serviceRole, {
      projectId,
      projectElementId: elementId,
      itemId: args.itemId,
      methodType: "Make to Order",
      quantity: args.quantity,
      unitOfMeasureCode: item.data.unitOfMeasureCode ?? undefined,
      unitCost:
        cost.data?.unitCost === null || cost.data?.unitCost === undefined
          ? undefined
          : Number(cost.data.unitCost),
      requiredDate: args.dueDate || undefined,
      companyId,
      createdBy: ctx.auditUserId
    });
    if (line.error || !line.data) {
      return ctx.error(
        "internal",
        "Failed to add the plan line for the job",
        line.error
      );
    }
    materialId = line.data.id;
    addedMaterialId = line.data.id;
  }

  const job = await insertJob(
    serviceRole,
    db,
    {
      itemId: args.itemId,
      quantity: args.quantity,
      dueDate: args.dueDate || undefined,
      deadlineType: args.dueDate ? "Soft Deadline" : "No Deadline",
      locationId: args.locationId,
      unitOfMeasureCode:
        args.unitOfMeasureCode ?? item.data.unitOfMeasureCode ?? undefined,
      projectId,
      projectElementId: elementId,
      consumeToProject,
      fixedAssetId,
      customerContractLineId: args.customerContractLineId ?? null,
      companyId,
      createdBy: ctx.auditUserId
    },
    { source: "erp" }
  );
  if (job.error || !job.data) {
    if (addedMaterialId) {
      const removed = await deleteProjectElementMaterial(
        serviceRole,
        addedMaterialId,
        companyId
      );
      if (removed.error) {
        logger.error("Failed to remove the plan line of a failed job", {
          companyId,
          materialId: addedMaterialId,
          error: removed.error
        });
      }
    }
    return ctx.error("internal", "Failed to create the job", job.error);
  }

  const stamp = await serviceRole
    .from("projectElementMaterial")
    .update({
      jobId: job.data.id,
      updatedBy: ctx.auditUserId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", materialId)
    .eq("companyId", companyId);
  if (stamp.error) {
    // The job exists; only the plan line's pointer to it failed.
    logger.error("Failed to link the job to its plan line", {
      companyId,
      projectId,
      materialId,
      jobId: job.data.id,
      error: stamp.error
    });
  }

  return { jobId: job.data.id };
}

/**
 * The live Part CLIN of a project contract whose item is `itemId` and whose
 * billing element is `elementId` or one of its ancestors, when exactly one
 * exists: a plan line's Create Job links its job to that CLIN.
 */
export async function findPartContractLine(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    projectId: string;
    elementId: string;
    itemId: string;
  }
): Promise<string | null> {
  const result = await sql<{ id: string }>`
    WITH RECURSIVE chain AS (
      SELECT e."id", e."parentId", 0 AS depth
      FROM "projectElement" e
      WHERE e."id" = ${args.elementId}
        AND e."projectId" = ${args.projectId}
        AND e."companyId" = ${args.companyId}
      UNION ALL
      SELECT p."id", p."parentId", chain.depth + 1
      FROM "projectElement" p
      JOIN chain ON p."id" = chain."parentId"
      WHERE p."companyId" = ${args.companyId} AND chain.depth < 100
    )
    SELECT l."id"
    FROM "customerContractLine" l
    JOIN "customerContract" c
      ON c."id" = l."customerContractId" AND c."companyId" = l."companyId"
    WHERE l."companyId" = ${args.companyId}
      AND l."itemId" = ${args.itemId}
      AND l."projectElementId" IN (SELECT "id" FROM chain)
      AND c."billingBasis" = 'Project'
      AND c."status" IN ('Draft', 'Active')
      AND NOT EXISTS (
        SELECT 1 FROM "customerContractLine" a
        WHERE a."amendsLineId" = l."id" AND a."companyId" = l."companyId"
      )
    LIMIT 2
  `.execute(db);
  return result.rows.length === 1 ? (result.rows[0]?.id ?? null) : null;
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
      WHERE st."companyId" = ${args.companyId}
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
        .where("companyId", "=", args.companyId)
        .where("group", "=", "Unstarted")
        .orderBy("isDefault", "desc")
        .orderBy("sortOrder", "asc")
        .limit(1)
        .executeTakeFirst();
      if (!state)
        throw new Error(
          "The company has no Unstarted state (Settings → Projects)"
        );
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
        description: args.description
          ? toJson(JSON.parse(args.description))
          : null,
        sortOrder: Number(maxSortOrder) + 1,
        createdBy: args.userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    // The labels the New element modal chose, the company's own only.
    if (args.labelIds?.length) {
      const labels = await trx
        .selectFrom("projectLabel")
        .select("id")
        .where("companyId", "=", args.companyId)
        .where("id", "in", args.labelIds)
        .execute();
      if (labels.length > 0) {
        await trx
          .insertInto("projectElementLabel")
          .values(
            labels.map((label) => ({
              projectElementId: element.id,
              projectLabelId: label.id,
              companyId: args.companyId,
              createdBy: args.userId
            }))
          )
          .execute();
      }
    }

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
  /**
   * A Template source also copies the plan lines (materials, labor, other
   * costs) of the elements it copies. A service order takes them, so its
   * estimate has prices; Projects' Build from part does not.
   */
  includePlanLines?: boolean;
};

/** A Build from part form (`buildFromPartValidator`) as `BuildFromPartArgs`. */
export function toBuildFromPartArgs(
  data: {
    source: "Serial" | "Item" | "Template";
    itemId?: string;
    trackedEntityId?: string;
    templateProjectId?: string;
    parentId?: string;
    depth: number;
    includeBought: boolean;
  },
  companyId: string,
  projectId: string
): BuildFromPartArgs {
  return {
    companyId,
    projectId,
    parentId: data.parentId ?? null,
    depth: data.depth,
    includeBought: data.includeBought,
    source:
      data.source === "Serial"
        ? { trackedEntityId: data.trackedEntityId! }
        : data.source === "Item"
          ? { itemId: data.itemId! }
          : { templateProjectId: data.templateProjectId! }
  };
}

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
  table:
    | "projectElement"
    | "projectElementLink"
    | "projectElementMaterial"
    | "projectElementLabor"
    | "projectElementCost",
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
 * `planProjectCopy`; they keep their states, which are company-wide. Returns the element rows (parents first), the template's links
 * between them, and the count of BOM lines the source could not read.
 */
async function planBuildFromPart(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase> | KyselyTx,
  args: BuildFromPartArgs & BuildTarget
): Promise<{
  rows: BuildRow[];
  links: Record<string, unknown>[];
  planLines?: {
    materials: Record<string, unknown>[];
    labor: Record<string, unknown>[];
    costs: Record<string, unknown>[];
  };
  skippedLines: number;
}> {
  const stateOfGroup = (group: ProjectStateGroup) =>
    args.states.find((s) => s.group === group && s.isDefault)?.id ??
    args.states.find((s) => s.group === group)?.id;
  const defaultStateId = stateOfGroup("Unstarted");
  if (!defaultStateId)
    throw new Error("The company has no Unstarted state (Settings → Projects)");

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
    const noRows = Promise.resolve([] as Record<string, unknown>[]);
    const [elements, links, materials, labor, costs] = await Promise.all([
      ofTemplate(db, "projectElement", source),
      ofTemplate(db, "projectElementLink", source),
      args.includePlanLines
        ? ofTemplate(db, "projectElementMaterial", source)
        : noRows,
      args.includePlanLines
        ? ofTemplate(db, "projectElementLabor", source)
        : noRows,
      args.includePlanLines
        ? ofTemplate(db, "projectElementCost", source)
        : noRows
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
    // States are company-wide: a template element keeps its state.
    const stateIds = new Set(args.states.map((state) => state.id));

    const plan = planProjectCopy(
      {
        milestones: [],
        elements: keptElements as unknown as ProjectCopyElement[],
        elementLabels: [],
        links: links as unknown as ProjectCopySource["links"],
        materials: materials as unknown as ProjectCopySource["materials"],
        labor: labor as unknown as ProjectCopySource["labor"],
        costs: costs as unknown as ProjectCopySource["costs"]
      },
      args.projectId,
      args.identifier,
      makeCopyId,
      args.startSequence
    );
    let rootSort = args.startSortOrder;
    const rows = plan.elements.map((element) => {
      const isRoot = element.parentId === null;
      return {
        ...element,
        // The template's pinned codes would collide with the project's own;
        // the built elements derive theirs from where they land.
        wbsCode: null,
        parentId: element.parentId ?? args.parentId,
        stateId: stateIds.has(element.stateId)
          ? element.stateId
          : defaultStateId,
        sortOrder: isRoot
          ? ++rootSort
          : (element as Record<string, unknown>).sortOrder
      } as unknown as BuildRow;
    });
    return {
      rows,
      links: plan.links,
      planLines: args.includePlanLines
        ? {
            materials: plan.materials,
            labor: plan.labor,
            costs: plan.costs
          }
        : undefined,
      skippedLines: 0
    };
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
  return db
    .transaction()
    .execute((trx) => insertElementsFromPart(client, trx, args));
}

/**
 * The body of `buildElementsFromPart`, in the caller's transaction: a new
 * service order builds its tree in the transaction that creates its project.
 * `client` reads only an item's make method, never the project.
 */
export async function insertElementsFromPart(
  client: SupabaseClient<Database>,
  trx: KyselyTx,
  args: BuildFromPartArgs & { userId: string }
): Promise<{ count: number; skippedLines: number }> {
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
    table:
      | "projectElement"
      | "projectElementLink"
      | "projectElementMaterial"
      | "projectElementLabor"
      | "projectElementCost",
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
  if (plan.planLines) {
    await insertRows("projectElementMaterial", plan.planLines.materials);
    await insertRows("projectElementLabor", plan.planLines.labor);
    await insertRows("projectElementCost", plan.planLines.costs);
  }

  await trx
    .updateTable("project")
    .set({ nextElementSequence: target.startSequence + plan.rows.length })
    .where("id", "=", args.projectId)
    .where("companyId", "=", args.companyId)
    .execute();

  return { count: plan.rows.length, skippedLines: plan.skippedLines };
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
 * The project an element write changes, read as the caller; else the
 * refusal: the project does not load, or it is Closed (`closedMessage`).
 */
export async function requireOpenProject(
  ctx: ServiceContext,
  projectId: string,
  closedMessage = "A Closed project cannot change"
) {
  const project = await getProject(
    ctx.asCaller.supabase,
    ctx.company.id,
    projectId
  );
  if (project.error || !project.data) {
    return ctx.error("notFound", "Failed to load the project", project.error);
  }
  if (project.data.status === "Closed") return ctx.error("rule", closedMessage);
  return project.data;
}

/**
 * The sort order after the last sibling under `parentId` (the top level when
 * null): where a moved element goes.
 */
export async function getNextElementSortOrder(
  client: Client,
  args: { projectId: string; companyId: string; parentId: string | null }
) {
  let query = client
    .from("projectElement")
    .select("sortOrder")
    .eq("projectId", args.projectId)
    .eq("companyId", args.companyId)
    .order("sortOrder", { ascending: false })
    .limit(1);
  query = args.parentId
    ? query.eq("parentId", args.parentId)
    : query.is("parentId", null);
  const last = await query.maybeSingle();
  if (last.error) return { data: null, error: last.error };
  return { data: Number(last.data?.sortOrder ?? 0) + 1, error: null };
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
  db: Kysely<KyselyDatabase>,
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
    laborCategoryRates,
    timeZone,
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
      .from("laborCategoryRate")
      .select("laborCategoryId, costRate, effectiveFrom")
      .eq("companyId", args.companyId)
      .order("effectiveFrom", { ascending: false }),
    getCompanyTimeZone(client, args.companyId),
    client
      .from("employeeJob")
      .select("laborCategoryId")
      .eq("id", args.userId)
      .eq("companyId", args.companyId)
      .maybeSingle(),
    getElementTimeAndMaterials(db, args)
  ]);

  const error =
    element.error ??
    elements.error ??
    comments.error ??
    planLines.error ??
    costSummary.error ??
    laborCategories.error ??
    laborCategoryRates.error ??
    employeeJob.error;
  if (error) return { data: null, error };
  if (!element.data || element.data.projectId !== args.projectId) {
    return { data: null, error: null };
  }

  // Each category's cost rate in effect today, as the plan cost uses it: a
  // labor plan line's amount is its hours at that rate.
  const today = datetime.today(timeZone).toString();
  const costRates = new Map<string, number>();
  for (const rate of laborCategoryRates.data ?? []) {
    if (rate.effectiveFrom > today || costRates.has(rate.laborCategoryId)) {
      continue;
    }
    costRates.set(rate.laborCategoryId, Number(rate.costRate));
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
      laborCategories: (laborCategories.data ?? []).map((category) => ({
        ...category,
        costRate: costRates.get(category.id) ?? null
      })),
      defaultLaborCategoryId: employeeJob.data?.laborCategoryId ?? null,
      ledger: timeAndMaterials.ledger,
      openTime: timeAndMaterials.openTime,
      planActuals: timeAndMaterials.planActuals,
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
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    projectId: string;
    elementId: string;
    userId: string;
    changeRequestId: string | null;
  }
) {
  if (!args.changeRequestId) {
    const page = await getProjectElementPage(client, db, args);
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

  const overlay = await loadChangeRequestOverlay(db, {
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

  const page = await getProjectElementPage(client, db, { ...args, element });
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
 * Posts Submitted timesheet entries through the `post-timesheet` posting.
 * Returns an error message for the caller's flash, or null. The caller has
 * already authorized the change (its operation's gate).
 */
export async function postTimesheetEntries(
  ctx: ServiceContext,
  args: { timesheetEntryIds: string[] }
): Promise<string | null> {
  if (args.timesheetEntryIds.length === 0) return null;
  const { timesheetEntryIds } = args;
  const posting = await invokePosting(
    ctx,
    "post-timesheet",
    { timesheetEntryIds },
    postTimesheet
  );
  if (posting.error) {
    logger.error("Failed to post timesheet entries", {
      companyId: ctx.company.id,
      timesheetEntryIds,
      error: posting.error
    });
    return posting.error.message || "Failed to post the time";
  }
  return null;
}

/** What `invokeSaveTimesheetEntry` takes: the `save-timesheet-entry` input, with form blanks. */
export type SaveTimesheetEntryArgs = {
  employeeId: string;
  entryDate: string;
  projectId: string;
  projectElementId?: string | null;
  laborCategoryId: string;
  hours: number;
  note?: string;
  lateReason?: string;
  reason?: string;
  mode?: "cell" | "add";
  status?: "Draft" | "Submitted";
  /** R&D tax: left out takes the default; "" or null is none. */
  workLocationId?: string | null;
  rdActivityRole?: RdActivityRole | "" | null;
  /** Shop time: left out matches any job; "" or null is none. */
  jobId?: string | null;
  jobOperationId?: string | null;
};

/**
 * The `save-timesheet-entry` input of a form's values: an empty element,
 * work location or R&D role is none; one left out keeps its default.
 */
export function saveTimesheetEntryPostingInput(input: SaveTimesheetEntryArgs) {
  return {
    ...input,
    projectElementId: input.projectElementId || null,
    workLocationId:
      input.workLocationId === undefined
        ? undefined
        : input.workLocationId || null,
    rdActivityRole:
      input.rdActivityRole === undefined
        ? undefined
        : input.rdActivityRole || null,
    jobId: input.jobId === undefined ? undefined : input.jobId || null,
    jobOperationId:
      input.jobOperationId === undefined
        ? undefined
        : input.jobOperationId || null
  };
}

/**
 * Saves one timesheet entry through the `save-timesheet-entry` posting,
 * which applies the DCAA rules in one place for the ERP and the MES.
 * `mode: "add"` (Log time) always adds a new entry with `status`; the
 * default edits the grid cell. Returns
 * the saved entry, or the refusal message. The caller has already
 * authorized the change.
 */
export async function invokeSaveTimesheetEntry(
  ctx: ServiceContext,
  input: SaveTimesheetEntryArgs
): Promise<
  | { data: SaveTimesheetEntryResult; error: null }
  | { data: null; error: string }
> {
  const saved = await invokePosting(
    ctx,
    "save-timesheet-entry",
    saveTimesheetEntryPostingInput(input),
    saveTimesheetEntry
  );
  if (saved.error || !saved.data) {
    logger.error("Failed to save a timesheet entry", {
      companyId: ctx.company.id,
      employeeId: input.employeeId,
      error: saved.error
    });
    return {
      data: null,
      error: saved.error?.message || "Failed to save the time"
    };
  }
  return { data: saved.data, error: null };
}

/** The `post-project-issue` input of the issue form's values. */
export function projectIssuePostingInput(
  input: z.infer<typeof projectIssueValidator>
) {
  return {
    ...input,
    projectElementId: input.projectElementId ?? null,
    storageUnitId: input.storageUnitId ?? null,
    trackedEntityId: input.trackedEntityId ?? null
  };
}

/**
 * Issues stock to a project, or returns it, through the `post-project-issue`
 * posting. Returns an error message (a `ProjectChargeError` refusal reads as
 * its own message), or null. The caller has already authorized the change.
 */
export async function invokePostProjectIssue(
  ctx: ServiceContext,
  input: z.infer<typeof projectIssueValidator>
): Promise<string | null> {
  const posting = await invokePosting(
    ctx,
    "post-project-issue",
    projectIssuePostingInput(input),
    postProjectIssue
  );
  if (posting.error) {
    logger.error("Failed to post project issue", {
      companyId: ctx.company.id,
      projectId: input.projectId,
      error: posting.error
    });
    return posting.error.message || "Failed to issue the material";
  }
  return null;
}

/**
 * Charges a cost to an element: inserts a `projectExpenseEntry` and posts it
 * through `post-project-expense` (Dr the project account / Cr GRNI, one
 * Other Direct ledger row). An entry that does not post is deleted again, so
 * a refusal (a closed element, a Capitalize project) leaves nothing behind.
 * Returns an error message, or null.
 */
export async function addProjectExpense(
  ctx: ServiceContext,
  args: z.infer<typeof projectExpenseValidator>
): Promise<string | null> {
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const entry = await db
    .insertInto("projectExpenseEntry")
    .values({
      companyId,
      projectId: args.projectId,
      projectElementId: args.projectElementId,
      employeeId: userId,
      entryDate: args.entryDate,
      description: args.description,
      amount: args.amount,
      createdBy: userId
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const posting = await invokePosting(
    ctx,
    "post-project-expense",
    { projectExpenseEntryId: entry.id },
    postProjectExpense
  );
  if (!posting.error) return null;

  logger.error("Failed to post a project expense", {
    companyId,
    projectExpenseEntryId: entry.id,
    error: posting.error
  });
  // The posting rolled back, so the entry has no journal or ledger row.
  try {
    await db
      .deleteFrom("projectExpenseEntry")
      .where("id", "=", entry.id)
      .where("companyId", "=", companyId)
      .where("journalId", "is", null)
      .execute();
  } catch (deleteError) {
    logger.error("Failed to delete an expense that did not post", {
      companyId,
      projectExpenseEntryId: entry.id,
      error: deleteError
    });
  }
  return posting.error.message || "Failed to charge the cost";
}
/**
 * A project's own stock: on-hand per item, location, storage unit and lot,
 * summed from its stripe of `itemLedger` in one query. Rows that net to zero
 * drop out.
 */
export async function getProjectStockOnHand(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; projectId: string }
) {
  const rows = await db
    .selectFrom("itemLedger")
    .leftJoin("storageUnit", "storageUnit.id", "itemLedger.storageUnitId")
    .leftJoin("trackedEntity", "trackedEntity.id", "itemLedger.trackedEntityId")
    .select([
      "itemLedger.itemId",
      "itemLedger.locationId",
      "itemLedger.storageUnitId",
      "storageUnit.name as storageUnitName",
      "itemLedger.trackedEntityId",
      "trackedEntity.readableId as trackedEntityReadableId",
      (eb) => eb.fn.sum<number>("itemLedger.quantity").as("quantity")
    ])
    .where("itemLedger.companyId", "=", args.companyId)
    .where("itemLedger.projectId", "=", args.projectId)
    .groupBy([
      "itemLedger.itemId",
      "itemLedger.locationId",
      "itemLedger.storageUnitId",
      "storageUnit.name",
      "itemLedger.trackedEntityId",
      "trackedEntity.readableId"
    ])
    .having((eb) => eb.fn.sum("itemLedger.quantity"), "<>", 0)
    .orderBy("itemLedger.itemId")
    .orderBy("storageUnit.name")
    .execute();

  return rows.map((row) => ({ ...row, quantity: Number(row.quantity) }));
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
  itemId: string | null;
  laborCategoryId: string | null;
  employeeId: string | null;
  /** An expense's own description (`projectExpenseEntry`). */
  description: string | null;
  readableId: string | null;
  /** The job that posted the row; the Actual tab folds a job's rows. */
  jobId: string | null;
  jobReadableId: string | null;
  jobItemId: string | null;
};

export type ElementOpenTimeRow = {
  id: string;
  entryDate: string;
  employeeId: string;
  laborCategoryId: string;
  hours: number;
  status: string;
  readableId: string | null;
};

/**
 * What has been charged to the element itself (not its subtree), summed by
 * the key a plan line has: a material's item, a labor category, and an
 * expense's description (lower case, trimmed). The element page's Estimated
 * cards show each plan line's share beside its estimate. A job made from a
 * plan line reports to that line by its id: its rows are summed in `jobs`
 * and left out of the item and labor keys, so no cost counts twice.
 */
export type ElementPlanActuals = {
  materials: { itemId: string; amount: number }[];
  jobs: { jobId: string; amount: number }[];
  labor: {
    laborCategoryId: string;
    hours: number;
    openHours: number;
    amount: number;
  }[];
  costs: { description: string; amount: number }[];
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
): Promise<{
  ledger: ElementLedgerRow[];
  openTime: ElementOpenTimeRow[];
  planActuals: ElementPlanActuals;
}> {
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

  // A row whose job a plan line of this element made: that line takes it.
  const ownedByPlanLine = sql`
    EXISTS (
      SELECT 1 FROM "projectElementMaterial" m
      WHERE m."jobId" = l."jobId"
        AND m."companyId" = l."companyId"
        AND m."projectElementId" = ${args.elementId}
    )
  `;

  const [ledger, openTime, ledgerByLine, timeByCategory, expenses, jobs] =
    await Promise.all([
      sql<ElementLedgerRow>`
      ${subtree}
      SELECT l."id", l."postingDate", l."costType", l."documentType",
        l."documentId", l."quantity", l."unitOfMeasureCode", l."amount",
        l."itemId", l."laborCategoryId", l."employeeId", x."description",
        e."readableId", l."jobId", j."jobId" AS "jobReadableId",
        j."itemId" AS "jobItemId"
      FROM "projectLedger" l
      JOIN subtree s ON s."id" = l."projectElementId"
      LEFT JOIN "projectExpenseEntry" x
        ON l."documentType" = 'Project Expense'
        AND x."id" = l."documentId" AND x."companyId" = l."companyId"
      LEFT JOIN "projectElement" e
        ON e."id" = l."projectElementId" AND e."companyId" = l."companyId"
      LEFT JOIN "job" j
        ON j."id" = l."jobId" AND j."companyId" = l."companyId"
      WHERE l."companyId" = ${args.companyId}
        AND l."projectId" = ${args.projectId}
      ORDER BY l."postingDate" DESC, l."createdAt" DESC
      LIMIT ${TIME_AND_MATERIALS_LIMIT}
    `.execute(db),
      sql<ElementOpenTimeRow>`
      ${subtree}
      SELECT t."id", t."entryDate", t."employeeId", t."laborCategoryId",
        t."hours", t."status", e."readableId"
      FROM "timesheetEntry" t
      JOIN subtree s ON s."id" = t."projectElementId"
      LEFT JOIN "projectElement" e
        ON e."id" = t."projectElementId" AND e."companyId" = t."companyId"
      WHERE t."companyId" = ${args.companyId}
        AND t."projectId" = ${args.projectId}
        AND t."status" <> 'Posted'
      ORDER BY t."entryDate" DESC, t."createdAt" DESC
      LIMIT ${TIME_AND_MATERIALS_LIMIT}
    `.execute(db),
      // The plan-line keys, on the element's own rows and with no limit:
      // material cost by item, labor cost by category.
      sql<{ kind: "material" | "labor"; key: string; amount: number }>`
      SELECT
        CASE WHEN l."costType" = 'Labor' THEN 'labor' ELSE 'material' END
          AS "kind",
        CASE WHEN l."costType" = 'Labor' THEN l."laborCategoryId"
          ELSE l."itemId" END AS "key",
        SUM(l."amount") AS "amount"
      FROM "projectLedger" l
      WHERE l."companyId" = ${args.companyId}
        AND l."projectId" = ${args.projectId}
        AND l."projectElementId" = ${args.elementId}
        AND (
          (l."costType" = 'Labor' AND l."laborCategoryId" IS NOT NULL)
          OR (l."costType" IN ('Material', 'Material Variance')
            AND l."itemId" IS NOT NULL)
        )
        AND (l."jobId" IS NULL OR NOT ${ownedByPlanLine})
      GROUP BY 1, 2
    `.execute(db),
      // Hours by category: Posted (a correction's reversal is negative) and
      // not posted yet. A Statistical project posts time with no ledger row,
      // so the hours come from the entries.
      sql<{ laborCategoryId: string; hours: number; openHours: number }>`
      SELECT t."laborCategoryId",
        COALESCE(SUM(t."hours") FILTER (WHERE t."status" = 'Posted'), 0)
          AS "hours",
        COALESCE(SUM(t."hours") FILTER (
          WHERE t."status" NOT IN ('Posted', 'Rejected')
        ), 0) AS "openHours"
      FROM "timesheetEntry" t
      WHERE t."companyId" = ${args.companyId}
        AND t."projectId" = ${args.projectId}
        AND t."projectElementId" = ${args.elementId}
      GROUP BY t."laborCategoryId"
    `.execute(db),
      // Posted expenses by description (a reversal carries a negative amount).
      sql<{ description: string; amount: number }>`
      SELECT LOWER(BTRIM(x."description")) AS "description",
        SUM(x."amount") AS "amount"
      FROM "projectExpenseEntry" x
      WHERE x."companyId" = ${args.companyId}
        AND x."projectId" = ${args.projectId}
        AND x."projectElementId" = ${args.elementId}
        AND x."journalId" IS NOT NULL
      GROUP BY 1
    `.execute(db),
      // Every cost a plan line's job posted to the element, of every type.
      sql<{ jobId: string; amount: number }>`
      SELECT l."jobId", SUM(l."amount") AS "amount"
      FROM "projectLedger" l
      WHERE l."companyId" = ${args.companyId}
        AND l."projectId" = ${args.projectId}
        AND l."projectElementId" = ${args.elementId}
        AND l."jobId" IS NOT NULL
        AND ${ownedByPlanLine}
      GROUP BY l."jobId"
    `.execute(db)
    ]);

  const laborAmounts = new Map(
    ledgerByLine.rows
      .filter((row) => row.kind === "labor")
      .map((row) => [row.key, Number(row.amount)])
  );
  const laborCategoryIds = new Set([
    ...laborAmounts.keys(),
    ...timeByCategory.rows.map((row) => row.laborCategoryId)
  ]);
  const hoursByCategory = new Map(
    timeByCategory.rows.map((row) => [row.laborCategoryId, row])
  );

  return {
    ledger: ledger.rows.map((row) => ({
      ...row,
      quantity: row.quantity === null ? null : Number(row.quantity),
      amount: Number(row.amount)
    })),
    openTime: openTime.rows.map((row) => ({
      ...row,
      hours: Number(row.hours)
    })),
    planActuals: {
      materials: ledgerByLine.rows
        .filter((row) => row.kind === "material")
        .map((row) => ({ itemId: row.key, amount: Number(row.amount) })),
      jobs: jobs.rows.map((row) => ({
        jobId: row.jobId,
        amount: Number(row.amount)
      })),
      labor: [...laborCategoryIds].map((laborCategoryId) => ({
        laborCategoryId,
        hours: Number(hoursByCategory.get(laborCategoryId)?.hours ?? 0),
        openHours: Number(hoursByCategory.get(laborCategoryId)?.openHours ?? 0),
        amount: laborAmounts.get(laborCategoryId) ?? 0
      })),
      costs: expenses.rows.map((row) => ({
        description: row.description,
        amount: Number(row.amount)
      }))
    }
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
    receiveToProjectStock?: boolean;
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
      .select("id, costTreatment, projectStock")
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
  if (args.receiveToProjectStock && !project.data.projectStock) {
    return {
      field: "receiveToProjectStock",
      message:
        "The project has no project stock, so a job cannot receive into it"
    };
  }
  return null;
}

/**
 * Runs the budget availability check (Government Contracting 5c) and formats
 * its overruns in the company's base currency. Without `GOVERNMENT_CONTRACTING`
 * the ee check returns "ok", so the message is empty. Routes decide what a
 * `warn` or a `block` does (decision C4).
 */
export async function checkProjectBudget(
  db: Kysely<KyselyDatabase>,
  client: SupabaseClient<Database>,
  input: BudgetCheckInput
): Promise<BudgetCheckResult & { message: string }> {
  const result = await checkBudgetAvailability(db, client, input);
  return {
    ...result,
    message: await formatBudgetCheckMessage(db, input.companyId, result)
  };
}

/**
 * The budget warning of a saved timesheet entry (Government Contracting 5c).
 * A timesheet is never refused for budget (DCAAM 7641.90): the entry is
 * already saved, so this returns the overrun text or null, and sends the
 * `ProjectBudgetExceeded` notice to the owner of each Block project. Any
 * failure is logged and returns null, so it never fails the entry.
 */
export async function timesheetBudgetWarning(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    projectId: string;
    projectElementId?: string | null;
    laborCategoryId: string;
    entryDate: string;
    hours: number;
  }
): Promise<string | null> {
  try {
    const budget = await checkTimesheetBudget(db, client, {
      ...args,
      projectElementId: args.projectElementId || null
    });
    for (const notice of budget.notices) {
      try {
        await trigger("notify", {
          event: NotificationEvent.ProjectBudgetExceeded,
          companyId: args.companyId,
          documentId: notice.projectId,
          recipient: { type: "user", userId: notice.ownerId },
          title: notice.title,
          body: notice.body
        });
      } catch (err) {
        logger.error("Failed to send the budget exceeded notice", {
          companyId: args.companyId,
          projectId: notice.projectId,
          error: err
        });
      }
    }
    return budget.status === "warn" ? budget.message : null;
  } catch (err) {
    logger.error("Failed to check the timesheet budget", {
      companyId: args.companyId,
      projectId: args.projectId,
      error: err
    });
    return null;
  }
}

/**
 * The Transfer half of a planning Apply, shared by the purchasing and the
 * production planning routes. Creating a project stock transfer needs
 * `update: projects`, the permission of the transfer pages, on top of the
 * route's own. Returns what the route reports: the applied action ids, the
 * transfers created, and one message per action it could not apply.
 */
export async function applyTransferPlanningActions(args: {
  db: Kysely<KyselyDatabase>;
  companyId: string;
  userId: string;
  planningActionIds: string[];
}): Promise<{
  applied: string[];
  transfers: { id: string; projectStockTransferId: string }[];
  errors: string[];
}> {
  const { db, companyId, userId, planningActionIds } = args;
  if (planningActionIds.length === 0) {
    return { applied: [], transfers: [], errors: [] };
  }
  const claims = await getUserClaims(userId, companyId);
  if (!hasPermission(claims?.permissions, "projects", "update", companyId)) {
    return {
      applied: [],
      transfers: [],
      errors: planningActionIds.map(
        (id) =>
          `Planning action ${id} creates a project stock transfer, which needs projects permission`
      )
    };
  }
  const result = await createProjectStockTransfersFromActions(db, {
    companyId,
    userId,
    planningActionIds
  });
  if (result.error) {
    logger.error("Failed to create project stock transfers from planning", {
      companyId,
      userId,
      planningActionIds,
      error: result.error
    });
    return {
      applied: [],
      transfers: [],
      errors: [`Failed to create project stock transfers: ${result.error}`]
    };
  }
  return {
    applied: result.created.map((c) => c.planningActionId),
    transfers: result.created.map(({ id, projectStockTransferId }) => ({
      id,
      projectStockTransferId
    })),
    errors: result.alreadyApplied.map(
      (id) => `Planning action ${id} was already applied`
    )
  };
}

/**
 * Applies Transfer and Borrow planning actions, set-based in one transaction:
 * 1. claim the actions (Open → Actioned; the claim is the lock),
 * 2. create one Draft project stock transfer per claimed action, of the
 *    action's type, with one line for the action's item and quantity. A
 *    Borrow takes its payback date from `triggerValues.paybackDueDate`
 *    (Projects Phase 3: a member's stock lent to a short sibling),
 * 3. record each transfer on its action (`projectStockTransferId`).
 *
 * An action someone else applied first is returned in `alreadyApplied` and
 * gets no transfer. A failure rolls the whole batch back. Approving and
 * posting the transfers stay with the transfer pages.
 */
export async function createProjectStockTransfersFromActions(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; userId: string; planningActionIds: string[] }
): Promise<{
  created: {
    planningActionId: string;
    id: string;
    projectStockTransferId: string;
  }[];
  alreadyApplied: string[];
  error: string | null;
}> {
  const { companyId, userId, planningActionIds } = args;
  if (planningActionIds.length === 0) {
    return { created: [], alreadyApplied: [], error: null };
  }
  try {
    return await db.transaction().execute(async (trx) => {
      const claimed = await claimPlanningActions(trx, {
        ids: planningActionIds,
        companyId,
        userId,
        now: datetime.timestamp()
      });
      const alreadyApplied = planningActionIds.filter((id) => !claimed.has(id));
      const ids = planningActionIds.filter((id) => claimed.has(id));
      if (ids.length === 0) return { created: [], alreadyApplied, error: null };

      const actions = await trx
        .selectFrom("planningAction")
        .select([
          "id",
          "type",
          "itemId",
          "locationId",
          "fromProjectId",
          "toProjectId",
          "reason",
          "triggerValues"
        ])
        .where("id", "in", ids)
        .where("companyId", "=", companyId)
        .orderBy("id")
        .execute();
      const rows = actions.map((action) => {
        if (action.type !== "Transfer" && action.type !== "Borrow") {
          throw new Error(
            `Planning action ${action.id} is not a Transfer or a Borrow`
          );
        }
        // the quantity as it is at the claim, not as the page read it
        const quantity = Number(claimed.get(action.id)?.suggestedQuantity);
        if (!(quantity > 0)) {
          throw new Error(`Planning action ${action.id} has no quantity`);
        }
        const payback = (action.triggerValues as Record<string, unknown> | null)
          ?.paybackDueDate;
        const paybackDueDate =
          action.type === "Borrow" && typeof payback === "string"
            ? payback
            : null;
        if (action.type === "Borrow" && !paybackDueDate) {
          throw new Error(`Planning action ${action.id} has no payback date`);
        }
        return { ...action, type: action.type, quantity, paybackDueDate };
      });

      // One readable id per transfer, from the projectStockTransfer sequence.
      const sequence = await sql<{ id: string }>`
        SELECT get_next_sequence('projectStockTransfer', ${companyId}) AS id
        FROM generate_series(1, ${rows.length}::int)
      `.execute(trx);
      const readableIds = sequence.rows.map((row) => row.id);
      if (readableIds.length !== rows.length || readableIds.some((id) => !id)) {
        throw new Error("Failed to get the next transfer ids");
      }

      const headers = await trx
        .insertInto("projectStockTransfer")
        .values(
          rows.map((action, i) => ({
            companyId,
            projectStockTransferId: readableIds[i]!,
            type: action.type,
            fromProjectId: action.fromProjectId,
            toProjectId: action.toProjectId,
            paybackDueDate: action.paybackDueDate,
            locationId: action.locationId,
            reason: action.reason ?? "Planning action",
            planningActionId: action.id,
            createdBy: userId
          }))
        )
        .returning(["id", "planningActionId", "projectStockTransferId"])
        .execute();
      const headerByAction = new Map(
        headers.map((header) => [header.planningActionId, header])
      );

      await trx
        .insertInto("projectStockTransferLine")
        .values(
          rows.map((action) => ({
            companyId,
            projectStockTransferId: headerByAction.get(action.id)!.id,
            itemId: action.itemId,
            quantity: action.quantity,
            createdBy: userId
          }))
        )
        .execute();

      await sql`
        UPDATE "planningAction" AS a
        SET "projectStockTransferId" = v."transferId"
        FROM (VALUES ${sql.join(
          headers.map((h) => sql`(${h.planningActionId}, ${h.id})`)
        )}) AS v("actionId", "transferId")
        WHERE a."id" = v."actionId" AND a."companyId" = ${companyId}
      `.execute(trx);

      return {
        created: headers.map((header) => ({
          planningActionId: header.planningActionId!,
          id: header.id,
          projectStockTransferId: header.projectStockTransferId
        })),
        alreadyApplied,
        error: null
      };
    });
  } catch (err) {
    return {
      created: [],
      alreadyApplied: [],
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Projects Phase 3: the owners of the netting segments a planning order
 * names. A segment is a project with project stock or a planning group of the
 * company; '' (common) is left out. Returns the segments it found of each
 * kind, and the ones it did not find.
 */
export async function getPlanningSegmentOwners(
  client: SupabaseClient<Database>,
  companyId: string,
  segmentIds: string[]
): Promise<{
  projectIds: Set<string>;
  planningGroupIds: Set<string>;
  unknownIds: string[];
  error: string | null;
}> {
  const ids = [...new Set(segmentIds.filter(Boolean))];
  if (ids.length === 0) {
    return {
      projectIds: new Set(),
      planningGroupIds: new Set(),
      unknownIds: [],
      error: null
    };
  }
  const [projects, groups] = await Promise.all([
    client
      .from("project")
      .select("id")
      .in("id", ids)
      .eq("companyId", companyId)
      .eq("projectStock", true),
    client
      .from("planningGroup")
      .select("id")
      .in("id", ids)
      .eq("companyId", companyId)
  ]);
  const projectIds = new Set((projects.data ?? []).map((row) => row.id));
  const planningGroupIds = new Set((groups.data ?? []).map((row) => row.id));
  return {
    projectIds,
    planningGroupIds,
    unknownIds: ids.filter(
      (id) => !projectIds.has(id) && !planningGroupIds.has(id)
    ),
    error: projects.error?.message ?? groups.error?.message ?? null
  };
}

/**
 * Projects Phase 3: an applied grouped Order or Make moves the pegs of its
 * planning action to the PO line or job it created, so the project costs
 * show the commitment at once instead of at the next MRP run. One
 * transaction for the whole batch:
 * 1. supersede the actions' current pegs,
 * 2. insert copies on the new supply.
 * A peg is never updated in place; the history keeps the planned peg.
 */
export async function moveActionPegsToSupply(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    moves: {
      planningActionId: string;
      supplyType: "Purchase Order Line" | "Job";
      supplyId: string;
    }[];
  }
): Promise<{ moved: number; error: string | null }> {
  const { companyId, userId } = args;
  const supplyByAction = new Map(
    args.moves.map((move) => [move.planningActionId, move])
  );
  if (supplyByAction.size === 0) return { moved: 0, error: null };
  try {
    const moved = await db.transaction().execute(async (trx) => {
      const superseded = await trx
        .updateTable("projectPeg")
        .set({ supersededAt: sql<string>`now()` })
        .where("companyId", "=", companyId)
        .where("supplyType", "=", "Planning Action")
        .where("supplyId", "in", [...supplyByAction.keys()])
        .where("supersededAt", "is", null)
        .returning([
          "planningGroupId",
          "itemId",
          "locationId",
          "supplyId",
          "projectId",
          "projectElementId",
          "demandSourceType",
          "demandSourceId",
          "parentPegId",
          "quantity",
          "needDate",
          "state"
        ])
        .execute();
      if (superseded.length === 0) return 0;
      await trx
        .insertInto("projectPeg")
        .values(
          superseded.map((peg) => {
            const move = supplyByAction.get(peg.supplyId)!;
            return {
              companyId,
              planningGroupId: peg.planningGroupId,
              itemId: peg.itemId,
              locationId: peg.locationId,
              supplyType: move.supplyType,
              supplyId: move.supplyId,
              projectId: peg.projectId,
              projectElementId: peg.projectElementId,
              demandSourceType: peg.demandSourceType,
              demandSourceId: peg.demandSourceId,
              parentPegId: peg.parentPegId,
              quantity: peg.quantity,
              needDate: peg.needDate,
              state: peg.state,
              createdBy: userId
            };
          })
        )
        .execute();
      return superseded.length;
    });
    return { moved, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to move planning action pegs to their supply", {
      companyId,
      planningActionIds: [...supplyByAction.keys()],
      error: message
    });
    return { moved: 0, error: message };
  }
}

/**
 * One employee's timesheet week for the grid (My Timesheet and the manager's
 * employee page). The week runs Monday to Sunday on the company calendar, as
 * the timecard does, so the two line up day by day. Returns the entries as
 * grid rows, the hours clocked per day, the labor categories, the company
 * settings and, in DCAA mode, the entries that have a correction trail. A
 * failed read is logged and shows as empty.
 */
export async function getTimesheetWeekView(
  client: SupabaseClient<Database>,
  args: { companyId: string; employeeId: string; weekOffset: number }
) {
  const { companyId, employeeId } = args;
  const offset = Number.isFinite(args.weekOffset) ? args.weekOffset : 0;
  const timeZone = await getCompanyTimeZone(client, companyId);
  const { weekStart, weekEnd, days, today, from, to } = timesheetWeek(
    timeZone,
    offset
  );

  const [entries, timecard, laborCategories, settings, job] = await Promise.all(
    [
      getTimesheetWeek(client, {
        companyId,
        employeeId,
        from: weekStart,
        to: weekEnd
      }),
      client
        .from("timeCardEntry")
        .select("clockIn, clockOut")
        .eq("employeeId", employeeId)
        .eq("companyId", companyId)
        .gte("clockIn", from)
        .lte("clockIn", to),
      getLaborCategoriesList(client, companyId),
      client.from("companySettings").select("*").eq("id", companyId).single(),
      // R&D tax: a new row's work location defaults to the job location.
      client
        .from("employeeJob")
        .select("locationId")
        .eq("id", employeeId)
        .eq("companyId", companyId)
        .maybeSingle()
    ]
  );
  for (const [what, result] of [
    ["the timesheet", entries],
    ["the timecard", timecard],
    ["labor categories", laborCategories],
    ["company settings", settings],
    ["the employee job", job]
  ] as const) {
    if (result.error) {
      logger.error("Failed to load the timesheet week", {
        companyId,
        what,
        error: result.error
      });
    }
  }

  // Hours clocked per day: each closed clock entry counts on the day it
  // started. Comparing two stored instants needs no time zone.
  const timecardHours: Record<string, number> = {};
  for (const entry of timecard.data ?? []) {
    if (!entry.clockOut) continue;
    const day = datetime.businessDay(entry.clockIn, timeZone).toString();
    const hours =
      (Date.parse(entry.clockOut) - Date.parse(entry.clockIn)) / 3_600_000;
    timecardHours[day] = (timecardHours[day] ?? 0) + Math.max(hours, 0);
  }

  // DCAA mode (5a): the cells that have a correction trail.
  const isDcaa = settings.data?.timekeepingControls === "DCAA";
  const entryIds = (entries.data ?? []).map((entry) => entry.id);
  let revisedEntryIds: string[] = [];
  if (isDcaa && entryIds.length > 0) {
    const revised = await client
      .from("timesheetEntryRevision")
      .select("timesheetEntryId")
      .eq("companyId", companyId)
      .in("timesheetEntryId", entryIds);
    if (revised.error) {
      logger.error("Failed to load the timesheet revisions", {
        companyId,
        error: revised.error
      });
    }
    revisedEntryIds = [
      ...new Set((revised.data ?? []).map((row) => row.timesheetEntryId))
    ];
  }

  return {
    week: {
      weekOffset: offset,
      weekStart,
      weekEnd,
      days,
      rows: groupTimesheetRows(entries.data ?? []),
      timecardHours,
      laborCategories: laborCategories.data ?? [],
      jobLocationId: job.data?.locationId ?? null
    },
    settings: settings.data,
    isDcaa,
    today,
    revisedEntryIds
  };
}

/**
 * The count the Projects sidebar shows on Approvals: the Submitted timesheet
 * entries, for a user who may approve them (`update: projects`). Any other
 * user, or a failed read, gets 0, so the sidebar shows no count.
 */
export async function getApprovalCountForUser(
  client: SupabaseClient<Database>,
  args: { companyId: string; userId: string }
): Promise<number> {
  const canApprove = hasPermission(
    (await getUserClaims(args.userId, args.companyId))?.permissions,
    "projects",
    "update",
    args.companyId
  );
  if (!canApprove) return 0;
  const result = await getTimesheetApprovalCount(client, args.companyId);
  if (result.error) {
    logger.error("Failed to count the timesheet entries waiting for approval", {
      companyId: args.companyId,
      error: result.error
    });
    return 0;
  }
  return result.count ?? 0;
}

/**
 * The contract billable items that wait for review (Unbilled or On Hold), for
 * a user who may review them (`update: projects` and `view: sales`, what the
 * Billing tab of Approvals needs). The Projects sidebar shows Approvals while
 * there are any, and adds them to its count. Any other user, or a failed
 * read, gets 0.
 */
export async function getBillingReviewCountForUser(
  client: SupabaseClient<Database>,
  args: { companyId: string; userId: string }
): Promise<number> {
  const permissions = (await getUserClaims(args.userId, args.companyId))
    ?.permissions;
  const canReview =
    hasPermission(permissions, "projects", "update", args.companyId) &&
    hasPermission(permissions, "sales", "view", args.companyId);
  if (!canReview) return 0;
  const result = await client
    .from("projectBillableItem")
    .select("id", { count: "exact", head: true })
    .eq("companyId", args.companyId)
    .not("customerContractLineId", "is", null)
    .in("status", ["Unbilled", "On Hold"]);
  if (result.error) {
    logger.error("Failed to count the billable items waiting for review", {
      companyId: args.companyId,
      error: result.error
    });
    return 0;
  }
  return result.count ?? 0;
}

// --- Projects → Reports ---------------------------------------------------------

/** A `YYYY-MM-DD` search param, or null when it is missing or not a date. */
function dateParam(value: string | null) {
  if (!value) return null;
  try {
    return parseDate(value).toString();
  } catch {
    return null;
  }
}

/**
 * The dates of a range report from its `startDate` and `endDate` search
 * params, and the fiscal year's start month for the range presets. A
 * missing or bad pair falls back to this month on the company's calendar,
 * the range the report page opens on.
 */
export async function getProjectReportRange(
  db: Kysely<KyselyDatabase>,
  request: Request,
  companyId: string
) {
  const params = new URL(request.url).searchParams;
  const [timeZone, settings] = await Promise.all([
    getCompanyTimeZone(db, companyId),
    db
      .selectFrom("fiscalYearSettings")
      .select("startMonth")
      .where("companyId", "=", companyId)
      .executeTakeFirst()
  ]);
  const fiscalStartMonth = monthNumber(settings?.startMonth);
  const startDate = dateParam(params.get("startDate"));
  const endDate = dateParam(params.get("endDate"));
  if (startDate && endDate && startDate <= endDate) {
    return { startDate, endDate, fiscalStartMonth };
  }
  const today = datetime.today(timeZone);
  return {
    startDate: today.set({ day: 1 }).toString(),
    endDate: endOfMonth(today).toString(),
    fiscalStartMonth
  };
}

/** A `taxYear` search param, or null when it is missing or not a year. */
export function taxYearParam(value: string | null) {
  const taxYear = Number(value);
  return value &&
    Number.isInteger(taxYear) &&
    taxYear >= 1900 &&
    taxYear <= 9999
    ? taxYear
    : null;
}

/**
 * The inputs of the R&D tax reports (§174A and Form 6765 Section G) for one
 * tax year. A null `taxYear` reads the tax year that holds today. A tax year
 * starts in the company's tax start month and is named by the calendar year
 * in which it starts.
 */
export async function getRdTaxReport(
  db: Kysely<KyselyDatabase>,
  client: SupabaseClient<Database>,
  args: { companyId: string; taxYear: number | null; withEmployees: boolean }
) {
  const [settings, company, timeZone] = await Promise.all([
    db
      .selectFrom("fiscalYearSettings")
      .select("taxStartMonth")
      .where("companyId", "=", args.companyId)
      .executeTakeFirst(),
    db
      .selectFrom("company")
      .select("taxId")
      .where("id", "=", args.companyId)
      .executeTakeFirst(),
    getCompanyTimeZone(db, args.companyId)
  ]);
  const taxStartMonth = monthNumber(settings?.taxStartMonth);
  const currentTaxYear = taxYearOf(
    datetime.today(timeZone).toString(),
    taxStartMonth
  );
  const taxYear = args.taxYear ?? currentTaxYear;
  const range = {
    companyId: args.companyId,
    ...taxYearBounds(taxYear, taxStartMonth)
  };
  const [rows, employees, components] = await Promise.all([
    getRdLedgerRows(db, range),
    args.withEmployees ? getRdEmployeeYear(db, range) : Promise.resolve([]),
    getRdComponents(client, args.companyId)
  ]);
  if (components.error) throw components.error;
  return {
    taxYear,
    currentTaxYear,
    rows,
    employees,
    components: components.data ?? [],
    ein: company?.taxId ?? null
  };
}

/**
 * The project's jobs, by the task whose plan line made each one
 * (`projectElementMaterial.jobId`). The Tree's job badge and the Overview's
 * job rows read it. A job a plan line does not name is not here.
 */
export async function getProjectJobs(
  client: Client,
  projectId: string,
  companyId: string
) {
  return client
    .from("projectElementMaterial")
    .select(
      "projectElementId, job:job!projectElementMaterial_jobId_fkey!inner(id, jobId, status, quantity, quantityComplete, dueDate, projectedCompletionAt, customerContractLineId)"
    )
    .eq("projectId", projectId)
    .eq("companyId", companyId)
    .not("jobId", "is", null)
    .order("createdAt", { ascending: true });
}
