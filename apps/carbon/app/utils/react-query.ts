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

export const locationsQuery = (companyId: string | null) => ({
  queryKey: ["locations", companyId ?? "null"],
  staleTime: RefreshRate.Low,
});

export const paymentTermsQuery = (companyId: string | null) => ({
  queryKey: ["paymentTerms", companyId ?? "null"],
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

export const uomsQuery = (companyId: string | null) => ({
  queryKey: ["uoms", companyId ?? "null"],
  staleTime: RefreshRate.Medium,
});
