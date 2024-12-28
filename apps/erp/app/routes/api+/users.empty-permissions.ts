import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getModules } from "~/modules/users";
import { makeEmptyPermissionsFromModules } from "~/modules/users/users.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "users",
    role: "employee",
  });

  const modules = await getModules(client);
  if (modules.error || modules.data === null) {
    return json(
      {
        permissions: {},
      },
      await flash(request, error(modules.error, "Failed to fetch modules"))
    );
  }

  return json({
    permissions: makeEmptyPermissionsFromModules(modules.data),
  });
}
