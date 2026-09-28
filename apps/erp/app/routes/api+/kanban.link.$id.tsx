import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getKanban } from "~/modules/inventory";
import { getActiveJobOperationByJobId } from "~/modules/production";
import { path } from "~/utils/path";

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

  const operation = await getActiveJobOperationByJobId(
    client,
    kanban.data.jobId!,
    companyId
  );

  if (!operation) {
    throw redirect(path.to.job(kanban.data.jobId!));
  }

  throw redirect(path.to.external.mesJobOperation(operation.id));
}
