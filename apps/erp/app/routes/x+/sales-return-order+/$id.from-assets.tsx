// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { salesReturnOrderFromAssetsValidator } from "~/modules/sales/sales.models";
import { getCustomerAssets } from "~/modules/service/service.service";
import { getCompanyTimeZone } from "~/modules/shared/shared.service";
import { path } from "~/utils/path";

/**
 * The RMA customer's assets for "Add from assets", newest first, searched by
 * serial. `onReturn` lists the assets already on this RMA.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const offsetParam = Number(url.searchParams.get("offset"));
  const search = url.searchParams.get("search")?.trim() || null;

  const [order, lines, timeZone] = await Promise.all([
    client
      .from("salesReturnOrder")
      .select("customerId")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle(),
    client
      .from("salesReturnOrderLine")
      .select("customerAssetId")
      .eq("salesReturnOrderId", id)
      .eq("companyId", companyId)
      .not("customerAssetId", "is", null),
    getCompanyTimeZone(client, companyId)
  ]);
  const customerId = order.data?.customerId;
  if (!customerId) {
    return { assets: [], count: 0, onReturn: [] as string[] };
  }

  const assets = await getCustomerAssets(client, companyId, {
    search,
    customerId,
    today: datetime.today(timeZone).toString(),
    limit:
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(limitParam, 100)
        : 5,
    offset: Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0
  });
  if (assets.error) {
    return { assets: [], count: 0, onReturn: [] as string[] };
  }

  return {
    assets: assets.data ?? [],
    count: assets.count ?? 0,
    onReturn: (lines.data ?? []).flatMap((line) =>
      line.customerAssetId ? [line.customerAssetId] : []
    )
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(salesReturnOrderFromAssetsValidator).request(
    args,
    { params: ["id"] }
  );
  if ("invalid" in input) return input.invalid;
  const orderId = input.params.id;
  const api = await carbon(args.request);
  const result = await api.sales.createReturnOrderLinesFromAssets({
    salesReturnOrderId: orderId,
    customerAssetIds: input.data.customerAssetIds
  });
  return respond(args.request, result).redirect(
    path.to.salesReturnOrderDetails(orderId),
    { message: "Added lines from assets" }
  );
}
