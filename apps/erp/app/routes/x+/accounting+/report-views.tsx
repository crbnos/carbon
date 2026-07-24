import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import {
  deleteReportView,
  reportViewValidator,
  upsertReportView
} from "~/modules/accounting";

// Resource route (action only) shared by all five report screens. Saves and
// deletes personal report views; owner-scoped RLS + userId scoping do the rest.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "accounting"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    const id = formData.get("id");
    if (typeof id !== "string" || !id) return { success: false };
    const result = await deleteReportView(client, id, userId);
    return { success: !result.error };
  }

  const validation = await validator(reportViewValidator).validate(formData);
  if (validation.error) return validationError(validation.error);

  const { id, report, name, params } = validation.data;
  let parsedParams: Record<string, string> = {};
  try {
    const parsed = JSON.parse(params);
    if (parsed && typeof parsed === "object") parsedParams = parsed;
  } catch {
    parsedParams = {};
  }

  const result = await upsertReportView(client, {
    id,
    userId,
    companyId,
    report,
    name,
    params: parsedParams
  });
  return { success: !result.error };
}
