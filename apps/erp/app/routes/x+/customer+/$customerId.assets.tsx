// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { datetime, redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import type { WarrantyStatus } from "~/modules/service";
import { getCustomerAssets, warrantyStatuses } from "~/modules/service";
import { CustomerAssetsTable } from "~/modules/service/ui/CustomerAssets";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { path } from "~/utils/path";
import { getGenericQueryFilters, takeQueryFilter } from "~/utils/query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "service"
  });
  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const searchParams = new URL(request.url).searchParams;
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);
  const warranty = takeQueryFilter(filters, "warrantyStatus");
  const warrantyStatus =
    warranty.values.length === 1 &&
    (warrantyStatuses as readonly string[]).includes(warranty.values[0]!)
      ? (warranty.values[0] as WarrantyStatus)
      : null;

  const timeZone = await getCompanyTimeZone(client, companyId);
  const assets = await getCustomerAssets(client, companyId, {
    search: searchParams.get("search"),
    customerId,
    warrantyStatus,
    today: datetime.today(timeZone).toString(),
    limit,
    offset,
    sorts,
    filters: warranty.filters
  });

  if (assets.error) {
    throw redirect(
      path.to.customer(customerId),
      await flash(
        request,
        error(assets.error, "Failed to load customer assets")
      )
    );
  }

  return {
    customerId,
    count: assets.count ?? 0,
    assets: assets.data ?? []
  };
}

export default function CustomerAssetsRoute() {
  const { customerId, count, assets } = useLoaderData<typeof loader>();

  return (
    <CustomerAssetsTable data={assets} count={count} customerId={customerId} />
  );
}
