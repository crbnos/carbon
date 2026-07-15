import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getUserSelectGroups } from "~/modules/users";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const url = new URL(request.url);
  const type = url.searchParams.get("type") || undefined;
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const limit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("limit")) || 25)
  );

  const result = await getUserSelectGroups(client, companyId, {
    type,
    limit: limit + 1, // fetch one extra row to compute hasMore
    offset
  });

  if (result.error) {
    return data(
      { groups: [], hasMore: false, error: result.error },
      await flash(request, error(result.error, "Failed to load groups"))
    );
  }

  const rows = result.data ?? [];
  return {
    groups: rows.slice(0, limit),
    hasMore: rows.length > limit
  };
}
