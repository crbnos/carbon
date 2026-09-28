import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs
} from "react-router";
import { invalidateInspectionDocuments } from "~/utils/react-query";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  // Each header field submits on its own; only update the fields sent.
  const update: Record<string, string | null> = {};
  for (const field of ["drawingNumber", "drawingRevision"] as const) {
    if (formData.has(field)) {
      update[field] = String(formData.get(field) ?? "").trim() || null;
    }
  }

  const result = await (client as any)
    .from("inspectionDocument")
    .update({
      ...update,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id);

  if (result.error) {
    return { success: false };
  }

  return { success: true };
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  invalidateInspectionDocuments();
  return await serverAction();
}
