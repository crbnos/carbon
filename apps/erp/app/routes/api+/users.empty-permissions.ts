import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { makeEmptyPermissionsFromModules } from "~/modules/users/users.server";
import { getModules } from "~/modules/users/users.service.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "users",
    role: "employee"
  });

  const modules = await getModules();
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
