import * as cookie from "cookie";

enum RefreshRate {
  Never = Infinity,
  High = 1000 * 60 * 2,
  Medium = 1000 * 60 * 10,
  Low = 1000 * 60 * 30,
}

export const getCompanyId = () => {
  const cookieHeader = document.cookie;
  const parsed = cookieHeader ? cookie.parse(cookieHeader)["companyId"] : null;
  return parsed;
};

export const abilitiesQuery = (companyId: string | null) => ({
  queryKey: ["abilities", companyId ?? "null"],
  staleTime: RefreshRate.Low,
});

export const countriesQuery = () => ({
  queryKey: ["countries"],
  staleTime: RefreshRate.Never,
});

export const currenciesQuery = () => ({
  queryKey: ["currencies"],
  staleTime: RefreshRate.Never,
});

export const customerContactsQuery = (customerId: string) => ({
  queryKey: ["customerContacts", customerId],
  staleTime: RefreshRate.Low,
});

export const customerLocationsQuery = (customerId: string) => ({
  queryKey: ["customerLocations", customerId],
  staleTime: RefreshRate.Low,
});

export const customerTypesQuery = (companyId: string | null) => ({
  queryKey: ["customerTypes", companyId ?? "null"],
  staleTime: RefreshRate.Low,
});

export const docsQuery = () => ({
  queryKey: ["docs"],
  staleTime: RefreshRate.Never,
});

export const locationsQuery = (companyId: string | null) => ({
  queryKey: ["locations", companyId ?? "null"],
  staleTime: RefreshRate.Low,
});

export const paymentTermsQuery = (companyId: string | null) => ({
  queryKey: ["paymentTerms", companyId ?? "null"],
  staleTime: RefreshRate.Low,
});

export const processesQuery = (companyId: string | null) => ({
  queryKey: ["processes", companyId ?? "null"],
  staleTime: RefreshRate.Low,
});

export const proceduresQuery = (companyId: string | null) => ({
  queryKey: ["procedures", companyId ?? "null"],
  staleTime: RefreshRate.Low,
});

export const shelvesQuery = (
  companyId: string | null,
  locationId: string | null
) => ({
  queryKey: ["shelves", companyId ?? "null", locationId ?? "null"],
  staleTime: RefreshRate.Low,
});

export const serialNumbersQuery = (
  companyId: string | null,
  itemId: string | null
) => ({
  queryKey: ["serialNumbers", companyId ?? "null", itemId ?? "null"],
  staleTime: RefreshRate.Low,
});

export const shippingMethodsQuery = (companyId: string | null) => ({
  queryKey: ["shippingMethods", companyId ?? "null"],
  staleTime: RefreshRate.Low,
});

export const supplierContactsQuery = (supplierId: string) => ({
  queryKey: ["supplierContacts", supplierId],
  staleTime: RefreshRate.Low,
});

export const supplierLocationsQuery = (supplierId: string) => ({
  queryKey: ["supplierLocations", supplierId],
  staleTime: RefreshRate.Low,
});

export const supplierProcessesQuery = (processId: string) => ({
  queryKey: ["supplierProcesses", processId],
  staleTime: RefreshRate.Low,
});

export const supplierTypesQuery = (companyId: string | null) => ({
  queryKey: ["supplierTypes", companyId ?? "null"],
  staleTime: RefreshRate.Low,
});

export const uomsQuery = (companyId: string | null) => ({
  queryKey: ["uoms", companyId ?? "null"],
  staleTime: RefreshRate.Medium,
});

export const webhookTablesQuery = () => ({
  queryKey: ["webhookTables"],
  staleTime: RefreshRate.Never,
});

export const workCentersQuery = (companyId: string | null) => ({
  queryKey: ["workCenters", companyId ?? "null"],
  staleTime: RefreshRate.Low,
});

export const materialTypesQuery = (
  substanceId: string,
  formId: string,
  companyId: string | null
) => ({
  queryKey: ["materialTypes", substanceId, formId, companyId ?? "null"],
  staleTime: RefreshRate.Low,
});
