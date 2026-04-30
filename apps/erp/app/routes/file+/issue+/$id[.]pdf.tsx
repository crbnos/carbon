import { requirePermissions } from "@carbon/auth/auth.server";
import { IssuePDF } from "@carbon/documents/pdf";
import { getPreferenceHeaders } from "@carbon/remix";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import {
  getIssue,
  getIssueActionTasks,
  getIssueApprovalTasks,
  getIssueAssociations,
  getIssueItems,
  getIssueReviewers,
  getIssueTypes,
  getRequiredActionsList
} from "~/modules/quality";
import { getCompany } from "~/modules/settings";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find issue id");

  const [
    company,
    nonConformance,
    nonConformanceTypes,
    actionTasks,
    approvalTasks,
    reviewers,
    requiredActions,
    items
  ] = await Promise.all([
    getCompany(client, companyId),
    getIssue(client, id),
    getIssueTypes(client, companyId),
    getIssueActionTasks(client, id, companyId),
    getIssueApprovalTasks(client, id, companyId),
    getIssueReviewers(client, id, companyId),
    getRequiredActionsList(client, companyId),
    getIssueItems(client, id, companyId)
  ]);

  // Get associations separately (returns plain object, not wrapped in { data })
  const associations = await getIssueAssociations(client, id, companyId);

  // Get job operation step records for action tasks
  const actionTaskIds = actionTasks.data?.map((task) => task.id) ?? [];
  const jobOperationStepRecords =
    actionTaskIds.length > 0
      ? await client
          .from("jobOperationStep")
          .select(
            "id, name, nonConformanceActionId, operationId, jobOperationStepRecord(*)"
          )
          .in("nonConformanceActionId", actionTaskIds)
          .not("nonConformanceActionId", "is", null)
      : { data: [] };

  // Get job IDs from job operations
  const operationIds =
    jobOperationStepRecords.data
      ?.map((step: any) => step.operationId)
      .filter(Boolean) ?? [];
  const jobOperations =
    operationIds.length > 0
      ? await client
          .from("jobOperation")
          .select("id, jobId, job(jobId)")
          .in("id", operationIds)
      : { data: [] };

  // Create a map of operationId -> jobId
  const operationToJobId: Record<string, string> = {};
  jobOperations.data?.forEach((op: any) => {
    if (op.job?.jobId) {
      operationToJobId[op.id] = op.job.jobId;
    }
  });

  // Build assignee and record creator lookup map
  const uniqueUsers = new Set<string>();

  // Add non-conformance creator
  if (nonConformance.data?.createdBy) {
    uniqueUsers.add(nonConformance.data.createdBy);
  }

  actionTasks.data?.forEach((task) => {
    if (task.assignee) uniqueUsers.add(task.assignee);
  });

  // Add createdBy users from job operation step records
  jobOperationStepRecords.data?.forEach((step: any) => {
    step.jobOperationStepRecord?.forEach((record: any) => {
      if (record.createdBy) uniqueUsers.add(record.createdBy);
    });
  });

  const userNames: Record<string, string> = {};
  if (uniqueUsers.size > 0) {
    const userResults = await Promise.all(
      Array.from(uniqueUsers).map((userId) =>
        client
          .from("user")
          .select("id, fullName, firstName, lastName")
          .eq("id", userId)
          .single()
      )
    );

    userResults.forEach((result) => {
      if (result.data) {
        userNames[result.data.id] =
          result.data.fullName ??
          `${result.data.firstName} ${result.data.lastName}`;
      }
    });
  }

  if (company.error) {
    console.error(company.error);
  }

  if (nonConformance.error) {
    console.error(nonConformance.error);
  }

  if (nonConformanceTypes.error) {
    console.error(nonConformanceTypes.error);
  }

  if (actionTasks.error) {
    console.error(actionTasks.error);
  }

  if (approvalTasks.error) {
    console.error(approvalTasks.error);
  }

  if (items.error) {
    console.error(items.error);
  }

  if (
    company.error ||
    nonConformance.error ||
    nonConformanceTypes.error ||
    actionTasks.error ||
    approvalTasks.error ||
    items.error
  ) {
    throw new Error("Failed to load issue");
  }

  const { locale } = getPreferenceHeaders(request);

  const stream = await renderToStream(
    <IssuePDF
      company={company.data as any}
      locale={locale}
      nonConformance={nonConformance.data}
      nonConformanceTypes={nonConformanceTypes.data ?? []}
      actionTasks={actionTasks.data ?? []}
      requiredActions={requiredActions.data ?? []}
      reviewers={reviewers.data ?? []}
      items={items.data ?? []}
      associations={associations}
      assignees={userNames}
      jobOperationStepRecords={jobOperationStepRecords.data ?? []}
      operationToJobId={operationToJobId}
    />
  );

  const body: Buffer = await new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (data) => {
      buffers.push(data);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(buffers));
    });
    stream.on("error", reject);
  });

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${company.data.name} - ${nonConformance.data.nonConformanceId}.pdf"`
  });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
