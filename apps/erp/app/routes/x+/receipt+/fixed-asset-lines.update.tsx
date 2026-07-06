import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";

export async function action({ request }: ActionFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    update: "inventory"
  });

  const formData = await request.formData();
  const id = formData.get("id") as string;
  const field = formData.get("field") as string;
  const value = formData.get("value") as string | null;

  if (!id || !field) {
    return { error: { message: "Invalid form data" }, data: null };
  }

  if (field !== "received" && field !== "serialNumber") {
    return { error: { message: `Invalid field: ${field}` }, data: null };
  }

  const serviceRole = getCarbonServiceRole();

  const updateData: Record<string, unknown> = {};
  if (field === "received") {
    updateData.received = value === "true";
  } else if (field === "serialNumber") {
    updateData.serialNumber = value || null;
  }

  const update = await serviceRole
    .from("receiptFixedAssetLine")
    .update(updateData)
    .eq("id", id)
    .eq("companyId", companyId);

  return update;
}
