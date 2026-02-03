import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { arrayToTree } from "performant-array-to-tree";
import type {
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data } from "react-router";
import type { Group } from "~/modules/users";
import { getCompanyId, groupsByTypeQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const type = searchParams.get("type");

  const query = client.from("groups").select("*").eq("companyId", companyId);

  if (type === "employee") {
    query.eq("isCustomerOrgGroup", false);
    query.eq("isCustomerTypeGroup", false);
    query.eq("isSupplierOrgGroup", false);
    query.eq("isSupplierTypeGroup", false);
  } else if (type === "customer") {
    query.or("isCustomerTypeGroup.eq.true, isCustomerOrgGroup.eq.true");
  } else if (type === "supplier") {
    query.or("isSupplierTypeGroup.eq.true, isSupplierOrgGroup.eq.true");
  }

  const groups = await query;

  if (groups.error) {
    return data(
      { groups: [], error: groups.error },
      await flash(request, error(groups.error, "Failed to load groups"))
    );
  }

  return {
    groups: arrayToTree(groups.data) as Group[]
  };
}

export async function clientLoader({
  request,
  serverLoader
}: ClientLoaderFunctionArgs) {
  const companyId = getCompanyId();

  if (!companyId) {
    return await serverLoader<typeof loader>();
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type");

  const queryKey = groupsByTypeQuery(companyId, type).queryKey;
  const data =
    window?.clientCache?.getQueryData<Awaited<ReturnType<typeof loader>>>(
      queryKey
    );

  if (!data) {
    const serverData = await serverLoader<typeof loader>();
    window?.clientCache?.setQueryData(queryKey, serverData);
    return serverData;
  }

  return data;
}
clientLoader.hydrate = true;
