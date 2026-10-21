// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
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
  getServiceOrders,
  updateCustomerAssetNotes,
  upsertCustomerAsset
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

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "service"
  });
  const { assetId } = params;
  if (!assetId) throw new Error("Could not find assetId");

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "field") {
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
    const update = await updateCustomerAssetNotes(client, {
      id: assetId,
      notes,
      companyId,
      updatedBy: userId
    });
    if (update.error) {
      return data(
        { success: false, error: { message: update.error.message } },
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

  const update = await upsertCustomerAsset(client, {
    ...validation.data,
    id: assetId,
    companyId,
    updatedBy: userId
  });
  if (update.error) {
    throw redirect(
      path.to.customerAsset(assetId),
      await flash(request, error(update.error, "Failed to update the asset"))
    );
  }

  throw redirect(
    path.to.customerAsset(assetId),
    await flash(request, success("Updated customer asset"))
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
