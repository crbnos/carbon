import { useRouteData } from "@carbon/react";
import { createContext, useContext } from "react";
import { path } from "~/utils/path";

type CompanySettings = {
  showSupplierReadableId?: boolean | null;
  showCustomerReadableId?: boolean | null;
  showCurrencyTrailingZeros?: boolean | null;
  allowLowercaseItemIds?: boolean | null;
} & Record<string, unknown>;

/** Set by a route that loaded the settings itself. `useRouteData` matches on the
 *  PATHNAME "/x", so it returns nothing outside the authenticated tree — the
 *  public share pages fetch companySettings in their own service-role loader and
 *  hand it down through here instead. Without it a customer-facing quote silently
 *  ignores every display preference the company set. */
const CompanySettingsContext = createContext<CompanySettings | undefined>(
  undefined
);

export const CompanySettingsProvider = CompanySettingsContext.Provider;

export function useCompanySettings(): CompanySettings | undefined {
  const provided = useContext(CompanySettingsContext);
  const data = useRouteData<{ companySettings?: CompanySettings }>(
    path.to.authenticatedRoot
  );
  return provided ?? data?.companySettings;
}
