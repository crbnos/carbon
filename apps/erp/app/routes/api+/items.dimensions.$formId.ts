import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getMaterialDimensionList } from "~/modules/items";
import { getCompanySettings } from "~/modules/settings";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  if (!params.formId) {
    return data({ error: "Form ID is required" }, { status: 400 });
  }

  const settings = await getCompanySettings();

  return await getMaterialDimensionList(
    params.formId,
    settings?.data?.useMetric ?? false
  );
}
