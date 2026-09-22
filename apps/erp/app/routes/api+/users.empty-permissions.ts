import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { makeEmptyPermissionsFromModules } from "@carbon/ee/permissions.server";
import { requireFeature } from "@carbon/ee/plan.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getModules } from "~/modules/users";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "users",
    role: "employee"
  });

  await requireFeature({
    request,
    client,
    companyId,
    redirectTo: path.to.employeeAccounts,
    feature: "PERMISSIONS"
  });

  const modules = await getModules(client);
  if (modules.error || modules.data === null) {
    return data(
      {
        permissions: {}
      },
      await flash(request, error(modules.error, "Failed to fetch modules"))
    );
  }

  return {
    permissions: makeEmptyPermissionsFromModules(modules.data)
  };
}
