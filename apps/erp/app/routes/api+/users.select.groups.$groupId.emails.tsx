import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getGroupEmails } from "~/modules/users";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const { groupId } = params;
  if (!groupId) {
    return { emails: [] };
  }

  // users_for_groups (SECURITY DEFINER) has no tenant check of its own —
  // verify the group belongs to the caller's company first.
  const group = await client
    .from("group")
    .select("id")
    .eq("id", groupId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (group.error) {
    return data(
      { emails: [], error: group.error },
      await flash(request, error(group.error, "Failed to load group emails"))
    );
  }

  if (!group.data) {
    return { emails: [] };
  }

  const emails = await getGroupEmails(client, [groupId]);
  return { emails: [...new Set(emails)] };
}
