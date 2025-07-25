import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getMaterialDimensionList } from "~/modules/items";
import { getCompanySettings } from "~/modules/settings";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee",
  });

  if (!params.formId) {
    return json({ error: "Form ID is required" }, { status: 400 });
  }

  const settings = await getCompanySettings(client, companyId);

  return json(
    await getMaterialDimensionList(
      client,
      params.formId,
      settings?.data?.useMetric ?? false,
      companyId
    )
  );
}
