import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getModules } from "~/modules/users";
import { makeEmptyPermissionsFromModules } from "~/modules/users/users.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { error } from "~/utils/result";

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
