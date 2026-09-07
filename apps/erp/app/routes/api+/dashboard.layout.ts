import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { dashboardLayoutValidator } from "~/modules/dashboard/dashboard.models";
import { upsertDashboardWidgets } from "~/modules/dashboard/dashboard.service";

// Personal preference: no module permission, RLS restricts rows to the owner.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {});

  const parsed = dashboardLayoutValidator.safeParse(await request.json());
  if (!parsed.success) {
    return data({ error: "Invalid layout" }, { status: 400 });
  }

  const result = await upsertDashboardWidgets(
    client,
    userId,
    companyId,
    parsed.data.widgets
  );
  if (result.error) {
    return data({ error: result.error.message }, { status: 500 });
  }

  return data({ success: true });
}
