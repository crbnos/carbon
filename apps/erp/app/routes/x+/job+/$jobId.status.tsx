import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { jobStatus } from "~/modules/production";
import { transitionJobStatus } from "~/modules/production/production.server";
import { requireCompanyRecord } from "~/modules/shared/shared.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { jobId: id } = params;
  if (!id) throw new Error("Could not find id");

  // Much of the transition (MRP, scheduling, picking sweeps, PO creation) runs
  // with the service role or Kysely and keys on the URL job id.
  await requireCompanyRecord(getCarbonServiceRole(), "job", companyId, { id });

  const url = new URL(request.url);
  const shouldSchedule = url.searchParams.get("schedule") === "1";

  const formData = await request.formData();
  const status = formData.get("status") as (typeof jobStatus)[number];
  const selectedPurchaseOrdersBySupplierId = formData.get(
    "selectedPurchaseOrdersBySupplierId"
  ) as string | null;
  const selectedSupplierProcessByOperationId = formData.get(
    "selectedSupplierProcessByOperationId"
  ) as string | null;

  if (!status || !jobStatus.includes(status)) {
    throw redirect(
      path.to.job(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  // A direct POST of status=Completed here bypasses complete_job_to_inventory
  // (no inventory receipt, no backflush) and therefore also skips the
  // picked-material return sweep. The UI never sends Completed to this route —
  // the Complete button uses $jobId.complete.tsx, which runs both.
  const result = await transitionJobStatus(client, {
    jobId: id,
    companyId,
    userId,
    status,
    schedule: shouldSchedule,
    purchaseOrdersBySupplierId: JSON.parse(
      selectedPurchaseOrdersBySupplierId ?? "{}"
    ),
    supplierProcessByOperationId: JSON.parse(
      selectedSupplierProcessByOperationId ?? "{}"
    )
  });
  if (result.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.job(id),
      await flash(request, error(result.cause, result.error.message))
    );
  }

  if (status === "Planned") {
    throw redirect(
      path.to.jobMaterials(id),
      await flash(request, success("Job marked as planned"))
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.job(id),
    await flash(request, success("Updated job status"))
  );
}
