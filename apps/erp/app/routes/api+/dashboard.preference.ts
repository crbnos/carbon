import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { dashboardPreferenceValidator } from "~/modules/dashboard/dashboard.models";
import { upsertDashboardPreference } from "~/modules/dashboard/dashboard.service";

// Personal preference: no module permission, RLS restricts rows to the owner.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {});

  const parsed = dashboardPreferenceValidator.safeParse(await request.json());
  if (!parsed.success) {
    return data({ error: "Invalid preference" }, { status: 400 });
  }

  const result = await upsertDashboardPreference(
    client,
    userId,
    companyId,
    parsed.data
  );
  if (result.error) {
    return data({ error: result.error.message }, { status: 500 });
  }

  return data({ success: true });
}
