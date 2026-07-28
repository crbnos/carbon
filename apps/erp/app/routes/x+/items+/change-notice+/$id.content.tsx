import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { updateChangeNotice } from "~/modules/items";
import { requireEditableChangeNoticeRoute } from "~/modules/items/items.server";

// The two rich-text header columns. They used to be written straight from the
// browser via the supabase client, which left no server-side place to enforce
// the engineering lock — hence this action.
const CONTENT_FIELDS = ["reasonForChange", "description"] as const;

type ContentField = (typeof CONTENT_FIELDS)[number];

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");
  const locked = await requireEditableChangeNoticeRoute(request, {
    client,
    changeNoticeId: params.id,
    companyId,
    scope: "engineering"
  });
  if (locked) return locked;

  const formData = await request.formData();
  const field = formData.get("field");
  const content = formData.get("content");

  if (
    typeof field !== "string" ||
    !CONTENT_FIELDS.includes(field as ContentField) ||
    typeof content !== "string"
  ) {
    return { error: { message: "Invalid form data" }, data: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { error: { message: "Invalid content" }, data: null };
  }

  const result = await updateChangeNotice(client, {
    id,
    [field]: parsed,
    updatedBy: userId
  });

  if (result.error) {
    return { error: { message: "Failed to update change notice" }, data: null };
  }

  return { error: null, data: result.data };
}
