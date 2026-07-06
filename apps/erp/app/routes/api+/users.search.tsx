import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {
    role: "employee"
  });

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return { users: [] };
  }

  const excludeSelf = url.searchParams.get("excludeSelf") === "true";
  const allowedIds = url.searchParams
    .get("allowedIds")
    ?.split(",")
    .filter(Boolean);

  const query = client
    .from("user")
    .select("id, firstName, lastName, fullName, email, avatarUrl")
    .eq("active", true)
    .ilike("fullName", `%${q}%`)
    .order("lastName")
    .limit(20);

  if (excludeSelf) {
    query.neq("id", userId);
  }

  if (allowedIds && allowedIds.length > 0) {
    query.in("id", allowedIds);
  }

  const result = await query;

  if (result.error) {
    return data(
      { users: [], error: result.error },
      await flash(request, error(result.error, "Failed to search users"))
    );
  }

  return { users: result.data ?? [] };
}
