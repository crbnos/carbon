import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { resolveUserSelectIds } from "~/modules/users";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const url = new URL(request.url);
  const ids = [
    ...new Set((url.searchParams.get("ids") ?? "").split(",").filter(Boolean))
  ].slice(0, 200);

  if (ids.length === 0) {
    return { users: [], groups: [] };
  }

  const { users, groups } = await resolveUserSelectIds(client, companyId, ids);

  if (users.error || groups.error) {
    const firstError = users.error ?? groups.error;
    return data(
      { users: [], groups: [], error: firstError },
      await flash(request, error(firstError, "Failed to resolve selections"))
    );
  }

  return { users: users.data ?? [], groups: groups.data ?? [] };
}
