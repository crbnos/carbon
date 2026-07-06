import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    role: "employee"
  });

  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids");
  if (!idsParam) return { users: [] };

  const ids = idsParam.split(",").filter(Boolean);

  if (ids.length === 0) return { users: [] };

  const query = await client
    .from("user")
    .select("id, firstName, lastName, fullName, email, avatarUrl")
    .in("id", ids);

  if (query.error) {
    return data(
      { users: [], error: query.error },
      await flash(request, error(query.error, "Failed to load users"))
    );
  }

  return { users: query.data ?? [] };
}
