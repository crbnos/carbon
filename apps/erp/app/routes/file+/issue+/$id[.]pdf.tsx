import { requirePermissions } from "@carbon/auth/auth.server";
import { IssuePDF } from "@carbon/documents/pdf";
import { renderToStream } from "@react-pdf/renderer";
import { type LoaderFunctionArgs } from "@vercel/remix";
import {
  getIssue,
  getIssueActionTasks,
  getIssueApprovalTasks,
  getIssueInvestigationTasks,
  getIssueReviewers,
  getIssueTypes,
} from "~/modules/quality";
import { getCompany } from "~/modules/settings";
import { getLocale } from "~/utils/request";

export const config = { runtime: "nodejs" };

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find issue id");

  const [
    company,
    nonConformance,
    nonConformanceTypes,
    investigationTasks,
    actionTasks,
    approvalTasks,
    reviewers,
  ] = await Promise.all([
    getCompany(client, companyId),
    getIssue(client, id),
    getIssueTypes(client, companyId),
    getIssueInvestigationTasks(client, id, companyId),
    getIssueActionTasks(client, id, companyId),
    getIssueApprovalTasks(client, id, companyId),
    getIssueReviewers(client, id, companyId),
  ]);

  if (company.error) {
    console.error(company.error);
  }

  if (nonConformance.error) {
    console.error(nonConformance.error);
  }

  if (nonConformanceTypes.error) {
    console.error(nonConformanceTypes.error);
  }

  if (investigationTasks.error) {
    console.error(investigationTasks.error);
  }

  if (actionTasks.error) {
    console.error(actionTasks.error);
  }

  if (approvalTasks.error) {
    console.error(approvalTasks.error);
  }

  if (
    company.error ||
    nonConformance.error ||
    nonConformanceTypes.error ||
    investigationTasks.error ||
    actionTasks.error ||
    approvalTasks.error
  ) {
    throw new Error("Failed to load issue");
  }

  const locale = getLocale(request);

  const stream = await renderToStream(
    <IssuePDF
      company={company.data}
      locale={locale}
      nonConformance={nonConformance.data}
      nonConformanceTypes={nonConformanceTypes.data ?? []}
      investigationTasks={investigationTasks.data ?? []}
      actionTasks={actionTasks.data ?? []}
      reviewers={reviewers.data ?? []}
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
    "Content-Disposition": `attachment; filename="${nonConformance.data.nonConformanceId}.pdf"`,
  });
  return new Response(body, { status: 200, headers });
}
