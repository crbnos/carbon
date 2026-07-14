import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { isChangeOrderLocked, updateChangeOrder } from "~/modules/items";

// Inline field editor used by ChangeOrderProperties (and future inline editors).
// The fetcher posts { id, field, value }; only a curated set of header fields is
// writable here. Rich-text (reasonForChange/description) is written directly by
// ChangeOrderContent via the supabase client, so it is not handled here.
const EDITABLE_FIELDS = [
  "name",
  "changeOrderTypeId",
  "assignee",
  "priority",
  "openDate",
  "dueDate",
  "nonConformanceId"
] as const;

type EditableField = (typeof EDITABLE_FIELDS)[number];

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const id = formData.get("id");
  const field = formData.get("field");
  const value = formData.get("value");

  if (typeof id !== "string" || !id) {
    return { error: { message: "Invalid change order id" }, data: null };
  }
  if (
    typeof field !== "string" ||
    !EDITABLE_FIELDS.includes(field as EditableField)
  ) {
    return { error: { message: `Invalid field: ${field}` }, data: null };
  }

  // Locked guard — Done change orders are read-only.
  const existing = await client
    .from("changeOrder")
    .select("status")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();

  if (isChangeOrderLocked(existing.data?.status)) {
    return {
      error: { message: "Cannot modify a completed change order." },
      data: null
    };
  }

  const normalized = typeof value === "string" && value !== "" ? value : null;

  const result = await updateChangeOrder(client, {
    id,
    [field]: normalized,
    updatedBy: userId
  });

  if (result.error) {
    return { error: { message: "Failed to update change order" }, data: null };
  }

  return { error: null, data: result.data };
}
