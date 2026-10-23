// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  getCustomerAsset,
  getCustomerAssets,
  getServiceBacklog,
  getServiceJob,
  getServiceJobAssignmentsRange,
  getServiceJobEstimateLines,
  getServiceJobItems,
  getServiceJobs,
  getServiceJobTime
} from "./service.service";

export type CustomerAsset = NonNullable<
  Awaited<ReturnType<typeof getCustomerAssets>>["data"]
>[number];

export type CustomerAssetDetail = NonNullable<
  Awaited<ReturnType<typeof getCustomerAsset>>["data"]
>;

export type ServiceJob = NonNullable<
  Awaited<ReturnType<typeof getServiceJobs>>["data"]
>[number];

export type ServiceJobDetail = NonNullable<
  Awaited<ReturnType<typeof getServiceJob>>["data"]
>;

export type ServiceJobTime = NonNullable<
  Awaited<ReturnType<typeof getServiceJobTime>>["data"]
>[number];

export type ServiceJobItem = NonNullable<
  Awaited<ReturnType<typeof getServiceJobItems>>["data"]
>[number];

export type ServiceJobEstimateLine = NonNullable<
  Awaited<ReturnType<typeof getServiceJobEstimateLines>>["data"]
>[number];

export type ServiceJobAssignment = NonNullable<
  Awaited<ReturnType<typeof getServiceJobAssignmentsRange>>["data"]
>[number];

export type ServiceBacklogJob = NonNullable<
  Awaited<ReturnType<typeof getServiceBacklog>>["data"]
>[number];
