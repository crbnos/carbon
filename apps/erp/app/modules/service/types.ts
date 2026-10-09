// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  getCustomerAsset,
  getCustomerAssetComponents,
  getCustomerAssets,
  getServiceBillableItems,
  getServiceNode,
  getServiceOrder,
  getServiceOrders,
  getServiceVisit,
  getServiceVisits,
  getServiceWork
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

export type ServiceWorkNode = Awaited<
  ReturnType<typeof getServiceWork>
>["elements"][number];

export type ServiceNode = NonNullable<
  Awaited<ReturnType<typeof getServiceNode>>["data"]
>;

export type ServiceCharge = ServiceNode["charges"][number];

export type ServiceVisitDetail = NonNullable<
  Awaited<ReturnType<typeof getServiceVisit>>["data"]
>;
