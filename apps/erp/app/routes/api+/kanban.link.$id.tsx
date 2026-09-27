import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getKanban } from "~/modules/inventory";
import { getActiveJobOperationByJobId } from "~/modules/production";
import { path } from "~/utils/path";

const logger = getLogger("erp", "kanban-link");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const kanban = await getKanban(client, id, companyId);
  if (kanban.error) {
    throw notFound("Kanban not found");
  }

  if (!kanban.data?.jobId) {
    throw notFound("Kanban has no active job");
  }

  const activeOperation = await getActiveJobOperationByJobId(
    client,
    kanban.data.jobId!,
    companyId
  );
  // A failed read falls back to the job page, as "no active operation" does.
  if (activeOperation.error) {
    logger.error("Failed to load the job's active operation", {
      jobId: kanban.data.jobId,
      error: activeOperation.error
    });
  }
  const operation = activeOperation.data;

  if (!operation) {
    throw redirect(path.to.job(kanban.data.jobId!));
  }

  throw redirect(path.to.external.mesJobOperation(operation.id));
}
