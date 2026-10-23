// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { customerAssetUpdateValidator } from "~/modules/service/service.models";
import {
  getCustomerAsset,
  getCustomerAssetComponents,
  getCustomerAssetHistoryByComponent,
  getServiceOrderCosts,
  getServiceOrders
} from "~/modules/service/service.service";
import { CustomerAssetPage } from "~/modules/service/ui/CustomerAssets";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Customer Assets`, to: path.to.customerAssets },
    (data) => data?.asset?.trackedEntity?.readableId
  ),
  module: "service"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "service"
  });
  const { assetId } = params;
  if (!assetId) throw new Error("Could not find assetId");

  const [asset, components, history, orders] = await Promise.all([
    getCustomerAsset(client, assetId, companyId),
    getCustomerAssetComponents(client, assetId, companyId),
    getCustomerAssetHistoryByComponent(client, assetId, companyId),
    getServiceOrders(client, companyId, {
      search: null,
      customerAssetId: assetId,
      limit: 100,
      offset: 0
    })
  ]);

  if (asset.error) {
    throw redirect(
      path.to.customerAssets,
      await flash(request, error(asset.error, "Failed to load customer asset"))
    );
  }

  const costs = await getServiceOrderCosts(
    client,
    (orders.data ?? []).map((order) => order.projectId),
    companyId
  );

  return {
    asset: asset.data,
    components: components.data ?? [],
    history: history.data ?? [],
    orders: orders.data ?? [],
    orderCosts: costs.data ?? {}
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["assetId"] });
  if ("invalid" in input) return input.invalid;
  const { assetId } = input.params;
  const formData = await args.request.formData();
  const api = await carbon(args.request);

  if (formData.get("intent") === "field") {
    if (formData.get("field") !== "notes") {
      return data(
        { success: false, error: { message: "Unknown field" } },
        { status: 400 }
      );
    }
    const value = formData.get("value");
    let notes: Json;
    try {
      notes = JSON.parse(typeof value === "string" ? value : "{}");
    } catch {
      return data(
        { success: false, error: { message: "Invalid notes" } },
        { status: 400 }
      );
    }
    const result = await api.service.updateCustomerAssetNotes({
      id: assetId,
      notes
    });
    if (result.error) {
      return data(
        { success: false, error: { message: result.error.message } },
        { status: 400 }
      );
    }
    return { success: true };
  }

  const validation = await validator(customerAssetUpdateValidator).validate(
    formData
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await api.service.updateCustomerAsset({
    ...validation.data,
    id: assetId
  });
  return respond(args.request, result).redirect(
    path.to.customerAsset(assetId),
    {
      message: "Updated customer asset"
    }
  );
}

export default function CustomerAssetRoute() {
  const { asset, components, history, orders, orderCosts } =
    useLoaderData<typeof loader>();

  return (
    <CustomerAssetPage
      key={asset.id}
      asset={asset}
      components={components}
      history={history}
      orders={orders}
      orderCosts={orderCosts}
    />
  );
}
