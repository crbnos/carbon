import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type {
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data } from "react-router";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const { groupId } = params;
  if (!groupId) {
    throw new Response("Group ID is required", { status: 400 });
  }

  // The `groups` view returns multiple rows per id for nested groups (members
  // are identical), so take one row instead of erroring with `.single()`.
  const query = await client
    .from("groups")
    .select("users")
    .eq("id", groupId)
    .eq("companyId", companyId)
    .limit(1)
    .maybeSingle();

  if (query.error) {
    return data(
      { users: [], error: query.error },
      await flash(request, error(query.error, "Failed to load group members"))
    );
  }

  return { users: query.data?.users ?? [] };
}

export async function clientLoader({
  params,
  serverLoader
}: ClientLoaderFunctionArgs) {
  const { groupId } = params;
  if (!groupId) {
    return await serverLoader<typeof loader>();
  }

  const queryKey = ["groupMembers", groupId];
  const cached =
    window?.clientCache?.getQueryData<Awaited<ReturnType<typeof loader>>>(
      queryKey
    );

  if (cached) {
    return cached;
  }

  const serverData = await serverLoader<typeof loader>();
  window?.clientCache?.setQueryData(queryKey, serverData);
  return serverData;
}
clientLoader.hydrate = true;
