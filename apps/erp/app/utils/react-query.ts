import type { QueryClient } from "@tanstack/react-query";
import * as cookie from "cookie";

enum RefreshRate {
  Never = Infinity,
  High = 1000 * 60 * 2,
  Medium = 1000 * 60 * 10,
  Low = 1000 * 60 * 30
}

export const getCompanyId = () => {
  if (typeof document === "undefined") {
    return null;
  }

  const cookieHeader = document.cookie;
  // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
  const parsed = cookieHeader ? cookie.parse(cookieHeader)["companyId"] : null;
  return parsed ?? null;
};

export const getClientCache = (): QueryClient | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.clientCache;
};

export const abilitiesQuery = (companyId: string | null) => ({
  queryKey: ["abilities", companyId ?? "null"],
  staleTime: RefreshRate.Low
});

export const accountsQuery = (companyId: string | null) => ({
  queryKey: ["accounts", companyId ?? "null"],
  staleTime: RefreshRate.Low
});

export const countriesQuery = () => ({
  queryKey: ["countries"],
  staleTime: RefreshRate.Never
});

export const currenciesQuery = () => ({
  queryKey: ["currencies"],
  staleTime: RefreshRate.Never
});

export const customerContactsQuery = (customerId: string) => ({
  queryKey: ["customerContacts", customerId],
  staleTime: RefreshRate.Low
});

export const customerLocationsQuery = (customerId: string) => ({
  queryKey: ["customerLocations", customerId],
  staleTime: RefreshRate.Low
});

export const customerTypesQuery = (companyId: string | null) => ({
  queryKey: ["customerTypes", companyId ?? "null"],
  staleTime: RefreshRate.Low
});

export const configurableItemsQuery = (companyId: string | null) => ({
  queryKey: ["configurableItems", companyId ?? "null"],
  staleTime: RefreshRate.Low
});

export const docsQuery = () => ({
  queryKey: ["docs"],
  staleTime: RefreshRate.Never
});

export const itemPostingGroupsQuery = (companyId: string | null) => ({
  queryKey: ["itemPostingGroups", companyId ?? "null"],
  staleTime: RefreshRate.Low
});

export const locationsQuery = (companyId: string | null) => ({
  queryKey: ["locations", companyId ?? "null"],
  staleTime: RefreshRate.Low
});

export const paymentTermsQuery = (companyId: string | null) => ({
  queryKey: ["paymentTerms", companyId ?? "null"],
  staleTime: RefreshRate.Low
});

export const processesQuery = (companyId: string | null) => ({
  queryKey: ["processes", companyId ?? "null"],
  staleTime: RefreshRate.Low
});

export const proceduresQuery = (companyId: string | null) => ({
  queryKey: ["procedures", companyId ?? "null"],
  staleTime: RefreshRate.Low
});

export const storageUnitsQuery = (
  companyId: string | null,
  locationId: string | null,
  itemId?: string | null
) => ({
  queryKey: [
    "storageUnits",
    companyId ?? "null",
    locationId ?? "null",
    itemId ?? "null"
  ],
  staleTime: RefreshRate.Low
});

export const serialNumbersQuery = (
  companyId: string | null,
  itemId: string | null
) => ({
  queryKey: ["serialNumbers", companyId ?? "null", itemId ?? "null"],
  staleTime: RefreshRate.Low
});

export const shippingMethodsQuery = (companyId: string | null) => ({
  queryKey: ["shippingMethods", companyId ?? "null"],
  staleTime: RefreshRate.Low
});

export const supplierContactsQuery = (supplierId: string) => ({
  queryKey: ["supplierContacts", supplierId],
  staleTime: RefreshRate.Low
});

export const supplierLocationsQuery = (supplierId: string) => ({
  queryKey: ["supplierLocations", supplierId],
  staleTime: RefreshRate.Low
});

export const supplierProcessesQuery = (processId: string) => ({
  queryKey: ["supplierProcesses", processId],
  staleTime: RefreshRate.Low
});

export const supplierTypesQuery = (companyId: string | null) => ({
  queryKey: ["supplierTypes", companyId ?? "null"],
  staleTime: RefreshRate.Low
});

export const uomsQuery = (companyId: string | null) => ({
  queryKey: ["uoms", companyId ?? "null"],
  staleTime: RefreshRate.Medium
});

export const storageRulesQuery = (
  companyId: string | null,
  targetType?: "item" | "storageUnit" | "workCenter" | null
) => ({
  queryKey: ["storageRules", targetType ?? "all", companyId ?? "null"],
  staleTime: RefreshRate.Low
});

export const storageRuleAssignmentsQuery = (
  targetType: "item" | "storageUnit" | "workCenter",
  targetId: string,
  companyId: string | null
) => ({
  queryKey: [
    "storageRuleAssignments",
    targetType,
    targetId,
    companyId ?? "null"
  ],
  staleTime: RefreshRate.Low
});

export const webhookTablesQuery = () => ({
  queryKey: ["webhookTables"],
  staleTime: RefreshRate.Never
});

export const workCentersQuery = (companyId: string | null) => ({
  queryKey: ["workCenters", companyId ?? "null"],
  staleTime: RefreshRate.Low
});

export const materialTypesQuery = (
  substanceId: string,
  formId: string,
  companyId: string | null
) => ({
  queryKey: ["materialTypes", substanceId, formId, companyId ?? "null"],
  staleTime: RefreshRate.Low
});

export const userSelectGroupsQuery = (
  companyId: string | null,
  type: string | null,
  offset: number
) => ({
  queryKey: ["userSelectGroups", companyId ?? "null", type ?? "all", offset],
  staleTime: RefreshRate.Low
});

export const userSelectMembersQuery = (
  companyId: string | null,
  groupId: string
) => ({
  queryKey: ["userSelectMembers", companyId ?? "null", groupId],
  staleTime: RefreshRate.Low
});

export const userSelectSearchQuery = (
  companyId: string | null,
  type: string | null,
  q: string,
  filters: string
) => ({
  queryKey: [
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
  queryKey: ["groupEmails", companyId ?? "null", groupId],
  staleTime: RefreshRate.Low
});

const USER_SELECT_QUERY_PREFIXES = [
  "userSelectGroups",
  "userSelectMembers",
  "userSelectSearch",
  "userSelectResolve",
  "groupEmails"
];

/**
 * Read-through fetch against an API route, cached in window.clientCache.
 * fetchQuery dedupes concurrent identical calls and honors staleTime.
 * Falls back to a plain fetch when the cache isn't mounted yet.
 */
export async function cachedApiQuery<T>(
  query: { queryKey: unknown[]; staleTime: number },
  url: string
): Promise<T> {
  const queryFn = async (): Promise<T> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
    return res.json();
  };
  const cache = getClientCache();
  if (!cache) return queryFn();
  return cache.fetchQuery({
    queryKey: query.queryKey,
    queryFn,
    staleTime: query.staleTime
  });
}

export function invalidateUserSelectQueries(companyId: string | null) {
  window.clientCache?.invalidateQueries({
    predicate: (query) => {
      const queryKey = query.queryKey as unknown[];
      return (
        USER_SELECT_QUERY_PREFIXES.includes(queryKey[0] as string) &&
        queryKey[1] === (companyId ?? "null")
      );
    }
  });
}
