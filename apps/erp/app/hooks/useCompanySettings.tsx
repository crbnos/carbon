import { useRouteData } from "@carbon/react";
import { path } from "~/utils/path";

type CompanySettings = {
  showSupplierReadableId?: boolean | null;
  showCustomerReadableId?: boolean | null;
} & Record<string, unknown>;

export function useCompanySettings(): CompanySettings | undefined {
  const data = useRouteData<{ companySettings?: CompanySettings }>(
    path.to.authenticatedRoot
  );
  return data?.companySettings;
}
