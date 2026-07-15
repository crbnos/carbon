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
      type,
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

  // groupMembers rows repeat per membership and carry the user as jsonb
  const seen = new Set<string>();
  const users: {
    id: string;
    firstName: string;
    lastName: string;
    fullName: string | null;
    email: string;
    avatarUrl: string | null;
  }[] = [];
  for (const row of usersResult.data ?? []) {
    const user = row.user as {
      id: string;
      firstName: string;
      lastName: string;
      fullName: string | null;
      email: string;
      avatarUrl: string | null;
    } | null;
    if (!user || !row.memberUserId || seen.has(row.memberUserId)) continue;
    seen.add(row.memberUserId);
    users.push({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      email: user.email,
      avatarUrl: user.avatarUrl
    });
  }
  users.sort((a, b) => (a.lastName ?? "").localeCompare(b.lastName ?? ""));

  return {
    groups: groupsResult.data ?? [],
    users: users.slice(0, 20)
  };
}
