import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getItemMpnsList } from "~/modules/items";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const result = await getItemMpnsList(client, companyId);

  // Dedupe distinct MPN values for the filter dropdown.
  const mpns = [
    ...new Set(
      (result.data ?? [])
        .map((row) => row.mpn)
        .filter((mpn): mpn is string => Boolean(mpn))
    )
  ];

  return { data: mpns };
}
