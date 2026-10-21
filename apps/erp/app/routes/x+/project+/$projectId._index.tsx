// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { hasPermission } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getUserClaims } from "@carbon/auth/users.server";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { usePermissions, useRouteData } from "~/hooks";
import {
  buildProjectCostFigures,
  getChildServiceProjectCosts,
  getProjectContractRevenue,
  getProjectCostSummary,
  getProjectElements,
  getProjectMembers,
  getProjectMilestones,
  getProjectOpenTimesheetEntries,
  type Project,
  summarizeMilestones
} from "~/modules/projects";
import ProjectMembers from "~/modules/projects/ui/Project/ProjectMembers";
import ProjectOverview from "~/modules/projects/ui/Project/ProjectOverview";
import { getContractLineFunding, projectContractFunded } from "~/modules/sales";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-overview");

/** The rows the Coming up and Recent activity cards show. */
const COMING_UP_LIMIT = 6;
const ACTIVITY_LIMIT = 6;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  // The project contract (the Contract card and its Needs attention rows) is
  // sales data; billing review also needs `update: projects`.
  const permissions = (await getUserClaims(userId, companyId))?.permissions;
  const canViewSales = hasPermission(permissions, "sales", "view", companyId);
  const canReviewBilling =
    canViewSales && hasPermission(permissions, "projects", "update", companyId);

  const [
    elements,
    costSummary,
    serviceCosts,
    milestones,
    openEntries,
    timeZone,
    members,
    comments,
    costs,
    projectContracts,
    billingReview
  ] = await Promise.all([
    getProjectElements(client, projectId, companyId),
    getProjectCostSummary(client, projectId, companyId),
    getChildServiceProjectCosts(client, projectId, companyId),
    getProjectMilestones(client, projectId, companyId),
    getProjectOpenTimesheetEntries(client, projectId, companyId),
    getCompanyTimeZone(client, companyId),
    getProjectMembers(client, projectId, companyId),
    // Recent activity: the latest comments and posted costs of the project.
    client
      .from("projectElementComment")
      .select(
        "id, createdAt, createdBy, element:projectElement!projectElementComment_element_fkey!inner(id, name, projectId)"
      )
      .eq("element.projectId", projectId)
      .eq("companyId", companyId)
      .order("createdAt", { ascending: false })
      .limit(ACTIVITY_LIMIT),
    client
      .from("projectLedger")
      .select(
        "id, createdAt, createdBy, costType, quantity, unitOfMeasureCode, amount, employeeId, itemId, reversalOfId, element:projectElement!projectLedger_element_fkey(id, name)"
      )
      .eq("projectId", projectId)
      .eq("companyId", companyId)
      .order("createdAt", { ascending: false })
      .limit(ACTIVITY_LIMIT),
    // The project contracts that bill the project, with their lines.
    canViewSales
      ? client
          .from("customerContract")
          .select(
            "id, customerContractId, name, status, lines:customerContractLine!customerContractLine_contract_fkey(id, billingMethod, fundedAmount, quantity, rate)"
          )
          .eq("companyId", companyId)
          .eq("projectId", projectId)
          .eq("billingBasis", "Project")
          .order("customerContractId")
      : null,
    // The project's contract billable items that wait for review.
    canReviewBilling
      ? client
          .from("projectBillableItem")
          .select("id", { count: "exact", head: true })
          .eq("companyId", companyId)
          .eq("projectId", projectId)
          .not("customerContractLineId", "is", null)
          .in("status", ["Unbilled", "On Hold"])
      : null
  ]);

  for (const [what, result] of [
    ["elements", elements],
    ["cost summary", costSummary],
    ["service order costs", serviceCosts],
    ["milestones", milestones],
    ["open time", openEntries],
    ["members", members],
    ["comments", comments],
    ["costs", costs],
    ["project contracts", projectContracts],
    ["billable items to review", billingReview]
  ] as const) {
    if (result?.error) {
      logger.error("Failed to load a part of the project overview", {
        what,
        companyId,
        projectId,
        error: result.error
      });
    }
  }

  const today = datetime.today(timeZone).toString();
  const elementRows = elements.data ?? [];

  // The Contract card: every confirmed project contract (Active or Ended)
  // together. Billing lines (T&M, Cost Plus) give the cost, billed and
  // unbilled amounts; a Fixed Price line is billed by its invoiced billing
  // events. Three reads, whatever the number of lines.
  const contracts = projectContracts?.data ?? [];
  const confirmed = contracts.filter((contract) => contract.status !== "Draft");
  const confirmedLines = confirmed.flatMap((contract) => contract.lines);
  const billingLineIds = confirmedLines
    .filter((line) => line.billingMethod !== "Fixed")
    .map((line) => line.id);
  const fixedLineIds = confirmedLines
    .filter((line) => line.billingMethod === "Fixed")
    .map((line) => line.id);
  const [funding, revenue, fixedBilled] =
    confirmed.length > 0
      ? await Promise.all([
          getContractLineFunding(client, {
            companyId,
            lineIds: billingLineIds,
            asOf: today
          }),
          getProjectContractRevenue(client, {
            companyId,
            lineIds: confirmedLines.map((line) => line.id)
          }),
          fixedLineIds.length > 0
            ? client
                .from("customerContractInvoiceLine")
                .select(
                  "amount, invoice:customerContractInvoice!customerContractInvoiceLine_invoice_fkey!inner(status)"
                )
                .eq("companyId", companyId)
                .in("customerContractLineId", fixedLineIds)
                .in("invoice.status", ["Invoiced", "Billed Externally"])
            : null
        ])
      : [null, null, null];
  for (const [what, result] of [
    ["contract funding", funding],
    ["contract revenue", revenue],
    ["fixed price billing", fixedBilled]
  ] as const) {
    if (result?.error) {
      logger.error("Failed to load a part of the project overview", {
        what,
        companyId,
        projectId,
        error: result.error
      });
    }
  }
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const fundingRows = funding?.data ?? [];
  const contract =
    confirmed.length > 0
      ? {
          // The card links the first Active contract, else the first one.
          id: (
            confirmed.find((row) => row.status === "Active") ?? confirmed[0]!
          ).id,
          funded: projectContractFunded(confirmedLines),
          incurred: sum(fundingRows.map((row) => Number(row.incurred))),
          billed:
            sum(fundingRows.map((row) => Number(row.billed))) +
            sum((fixedBilled?.data ?? []).map((row) => Number(row.amount))),
          unbilled: sum(fundingRows.map((row) => Number(row.unbilled))),
          revenue: sum(
            Object.values(revenue?.data ?? {}).map(
              (line) => line.recognizedToDate
            )
          )
        }
      : null;
  const draftContract = contracts.find(
    (contract) => contract.status === "Draft"
  );

  // The project total, as the Costs page's "Project total" row shows it.
  const serviceActual = (serviceCosts.data ?? []).reduce(
    (sum, row) => sum + Number(row.actual),
    0
  );
  const { project: figures } = buildProjectCostFigures(
    elementRows.map((element) => ({
      id: element.id,
      parentId: element.parentId,
      budget: element.budget,
      estimateAtCompletion: null
    })),
    costSummary.data ?? [],
    serviceActual
  );

  const milestoneSummaries = summarizeMilestones({
    milestones: milestones.data ?? [],
    elements: elementRows,
    costSummary: costSummary.data ?? [],
    today
  });

  // Progress counts the work: every element with no children of its own,
  // so a System that groups five Tasks counts five, not six. A Parameter is
  // no work, and does not make its parent a group.
  const trackable = elementRows.filter(
    (element) => element.type !== "Parameter"
  );
  const parentIds = new Set(trackable.map((element) => element.parentId));
  const work = trackable.filter((element) => !parentIds.has(element.id));
  const stateCounts: Record<string, number> = {};
  for (const element of work) {
    stateCounts[element.stateId] = (stateCounts[element.stateId] ?? 0) + 1;
  }
  const isOpen = (group: string | undefined) =>
    group === "Backlog" || group === "Unstarted" || group === "Started";
  const open = work.filter((element) => isOpen(element.state?.group));
  // Coming up lists every open element with a target date, groups included.
  const comingUp = trackable
    .filter((element) => isOpen(element.state?.group))
    .filter((element) => element.targetDate)
    .sort((a, b) => (a.targetDate ?? "").localeCompare(b.targetDate ?? ""))
    .slice(0, COMING_UP_LIMIT)
    .map((element) => ({
      id: element.id,
      name: element.name,
      stateGroup: element.state!.group,
      stateColor: element.state!.color,
      priority: element.priority,
      targetDate: element.targetDate!,
      ownerId: element.ownerId
    }));

  const activity = [
    ...(comments.data ?? []).map((comment) => ({
      id: comment.id,
      kind: "comment" as const,
      at: comment.createdAt,
      userId: comment.createdBy,
      element: { id: comment.element.id, name: comment.element.name },
      costType: null,
      quantity: null,
      unitOfMeasureCode: null,
      amount: null,
      itemId: null,
      isReversal: false
    })),
    ...(costs.data ?? []).map((cost) => ({
      id: cost.id,
      kind: "cost" as const,
      at: cost.createdAt,
      userId: cost.employeeId ?? cost.createdBy,
      element: cost.element
        ? { id: cost.element.id, name: cost.element.name }
        : null,
      costType: cost.costType,
      quantity: cost.quantity === null ? null : Number(cost.quantity),
      unitOfMeasureCode: cost.unitOfMeasureCode,
      amount: Number(cost.amount),
      itemId: cost.itemId,
      isReversal: Boolean(cost.reversalOfId)
    }))
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, ACTIVITY_LIMIT);

  return {
    today,
    figures: {
      budget: figures.budget,
      committed: figures.committed,
      actual: figures.actual
    },
    progress: {
      stateCounts,
      total: work.length,
      done: work.filter((e) => e.state?.group === "Completed").length,
      cancelled: work.filter((e) => e.state?.group === "Cancelled").length,
      overdue: open.filter((e) => e.targetDate && e.targetDate < today).length
    },
    comingUp,
    milestones: milestoneSummaries.map((milestone) => ({
      id: milestone.id,
      name: milestone.name,
      endDate: milestone.endDate,
      completedAt: milestone.completedAt
    })),
    activity,
    openTimeCount: openEntries.data?.length ?? 0,
    members: members.data ?? [],
    contract,
    // Null when the user cannot view sales: no contract row shows then.
    contractAttention: canViewSales
      ? {
          hasProjectContract: contracts.length > 0,
          draftContract: draftContract
            ? {
                id: draftContract.id,
                customerContractId: draftContract.customerContractId
              }
            : null,
          billingReviewCount: billingReview?.count ?? 0
        }
      : null
  };
}

/**
 * The project's Overview: a dashboard of quiet cards. The left column is the
 * work (About, Progress, Coming up, Budget, Needs attention); the right is
 * the project (Details, each field saved as it changes, Milestones, Members,
 * Recent activity). There is no Settings page.
 */
export default function ProjectOverviewRoute() {
  const { projectId } = useParams();
  if (!projectId) throw new Error("projectId not found");
  const data = useLoaderData<typeof loader>();
  const routeData = useRouteData<{ project: Project }>(
    path.to.project(projectId)
  );
  const permissions = usePermissions();
  const project = routeData?.project;
  const isDisabled =
    !permissions.can("update", "projects") || project?.status === "Closed";

  return (
    <ProjectOverview
      {...data}
      members={
        project?.restrictCharging ? (
          <ProjectMembers
            projectId={projectId}
            members={data.members}
            action={path.to.projectSettings(projectId)}
            isDisabled={isDisabled}
          />
        ) : null
      }
    />
  );
}
