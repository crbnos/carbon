import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { createQualityIssue } from "~/services/quality.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "quality"
  });
  const serviceRole = await getCarbonServiceRole();

  const formData = await request.formData();
  const jobOperationId = getRequiredFormValue(formData, "jobOperationId");
  const trackedEntityId = getOptionalFormValue(formData, "trackedEntityId");
  const userDescription = getOptionalFormValue(formData, "description");
  const nonConformanceTypeId = getOptionalFormValue(
    formData,
    "nonConformanceTypeId"
  );
  const priority = getOptionalFormValue(formData, "priority") as
    | "Low"
    | "Medium"
    | "High"
    | "Critical"
    | undefined;
  const quantity = normalizeQuantity(
    getOptionalFormValue(formData, "quantity")
  );

  if (!jobOperationId) {
    throw redirect(
      requestReferrer(request) ?? path.to.active,
      await flash(request, error(null, "Job operation is required"))
    );
  }

  const result = await createQualityIssue(serviceRole, {
    companyId,
    userId,
    jobOperationId,
    trackedEntityId,
    // The operator's free-text description doubles as the issue name (the
    // original MES behavior — the description body stays empty).
    name: userDescription,
    nonConformanceTypeId,
    priority,
    quantity
  });

  if (result.error || !result.data) {
    throw redirect(
      requestReferrer(request) ?? path.to.active,
      await flash(
        request,
        error(result.error, result.message ?? "Failed to create quality issue")
      )
    );
  }

  return success("Quality issue created");
}

function getRequiredFormValue(formData: FormData, key: string) {
  return (formData.get(key) as string | null)?.trim() ?? "";
}

function getOptionalFormValue(formData: FormData, key: string) {
  return (formData.get(key) as string | null)?.trim() || undefined;
}

function normalizeQuantity(value: string | undefined) {
  const quantity = Number(value ?? "1");
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}
