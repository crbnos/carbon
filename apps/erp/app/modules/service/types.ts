// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  getCustomerAsset,
  getCustomerAssetComponents,
  getCustomerAssets,
  getServiceBillableItems,
  getServiceOrder,
  getServiceOrders,
  getServiceVisits
} from "./service.service";

export type CustomerAsset = NonNullable<
  Awaited<ReturnType<typeof getCustomerAssets>>["data"]
>[number];

export type CustomerAssetDetail = NonNullable<
  Awaited<ReturnType<typeof getCustomerAsset>>["data"]
>;

export type CustomerAssetComponent = NonNullable<
  Awaited<ReturnType<typeof getCustomerAssetComponents>>["data"]
>[number];

export type ServiceOrderListItem = NonNullable<
  Awaited<ReturnType<typeof getServiceOrders>>["data"]
>[number];

export type ServiceOrder = NonNullable<
  Awaited<ReturnType<typeof getServiceOrder>>["data"]
>;

export type ServiceVisit = NonNullable<
  Awaited<ReturnType<typeof getServiceVisits>>["data"]
>[number];

export type ServiceBillableItem = NonNullable<
  Awaited<ReturnType<typeof getServiceBillableItems>>["data"]
>[number];
