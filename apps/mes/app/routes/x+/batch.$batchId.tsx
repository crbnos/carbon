import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getJobOperationBatch } from "~/services/operations.service";
import { path } from "~/utils/path";

// The batch experience now lives inside the operation view: opening any member
// operation runs the page in batch mode (shared timer + batch completion). This
// route only redirects legacy links (the ERP board's "Open in MES", the MES
// kanban batch card) to a member operation.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production"
  });
  const { batchId } = params;
  if (!batchId) throw new Error("Batch ID is required");

  const batch = await getJobOperationBatch(client, batchId, companyId);
  const firstMember = batch.data?.operations?.[0];
  if (batch.error || !firstMember) {
    throw redirect(
      path.to.operations,
      await flash(request, error(batch.error, "Batch has no operations"))
    );
  }

  throw redirect(path.to.operation(firstMember.id));
}
