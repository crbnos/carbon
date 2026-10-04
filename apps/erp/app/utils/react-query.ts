// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { LOADER, RefreshRate } from "@carbon/query/cache";

// The cache itself lives in @carbon/query. Re-exported so routes keep one
// import path; what stays here is the ERP's own component-level keys.
export {
  cachedApiQuery,
  cachedClientLoader,
  getClientCache,
  getCompanyId,
  LOADER,
  loaderQueryKey,
  RefreshRate,
  setClientCompanyId
} from "@carbon/query/cache";

// Component-level reads. Their keys start with LOADER so a mutation invalidates
// them with the loader entries.
export const accountsQuery = (companyId: string | null) => ({
  queryKey: [LOADER, "accounts", companyId ?? "null"],
  staleTime: RefreshRate.Low
});

export const ITEM_QUANTITIES_QUERY_KEY = "itemQuantities";

export const itemQuantitiesQuery = (
  locationId: string,
  companyId: string | null
) => ({
  queryKey: [ITEM_QUANTITIES_QUERY_KEY, companyId ?? "null", locationId],
  staleTime: RefreshRate.High
});

export const userSelectGroupsQuery = (
  companyId: string | null,
  type: string | null,
  offset: number
) => ({
  queryKey: [
    LOADER,
    "userSelectGroups",
    companyId ?? "null",
    type ?? "all",
    offset
  ],
  staleTime: RefreshRate.Low
});

export const userSelectMembersQuery = (
  companyId: string | null,
  groupId: string
) => ({
  queryKey: [LOADER, "userSelectMembers", companyId ?? "null", groupId],
  staleTime: RefreshRate.Low
});

export const userSelectSearchQuery = (
  companyId: string | null,
  type: string | null,
  q: string,
  filters: string
) => ({
  queryKey: [
    LOADER,
    "userSelectSearch",
    companyId ?? "null",
    type ?? "all",
    q,
    filters
  ],
  staleTime: RefreshRate.High
});

export const userSelectResolveQuery = (
  companyId: string | null,
  ids: string[]
) => ({
  queryKey: [
    LOADER,
    "userSelectResolve",
    companyId ?? "null",
    [...ids].sort().join(",")
  ],
  staleTime: RefreshRate.Low
});

export const groupEmailsQuery = (
  companyId: string | null,
  groupId: string
) => ({
  queryKey: [LOADER, "groupEmails", companyId ?? "null", groupId],
  staleTime: RefreshRate.Low
});
