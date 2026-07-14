import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getUserSelectGroups, searchUsersForSelect } from "~/modules/users";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    role: "employee"
  });

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return { groups: [], users: [] };
  }

  const type = url.searchParams.get("type") || undefined;
  const excludeSelf = url.searchParams.get("excludeSelf") === "true";
  const allowedIds = url.searchParams
    .get("allowedIds")
    ?.split(",")
    .filter(Boolean);

  const [groupsResult, usersResult] = await Promise.all([
    getUserSelectGroups(client, companyId, {
      type,
      search: q,
      limit: 10,
      offset: 0
    }),
    searchUsersForSelect(client, companyId, {
      q,
      excludeSelf,
      allowedIds,
      userId
    })
  ]);

  if (groupsResult.error || usersResult.error) {
    const firstError = groupsResult.error ?? usersResult.error;
    return data(
      { groups: [], users: [], error: firstError },
      await flash(request, error(firstError, "Failed to search users"))
    );
  }

  return {
    groups: groupsResult.data ?? [],
    users: (usersResult.data ?? []).map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      fullName: u.fullName,
      email: u.email,
      avatarUrl: u.avatarUrl
    }))
  };
}
