import type { Database } from "@carbon/database";
import { useRouteData } from "@carbon/react";
import { createContext, useContext } from "react";
import { path } from "~/utils/path";

/**
 * The `companySettings` columns client components read through this hook.
 *
 * Typed as a `Pick` of the generated Row so a typo is a COMPILE error: the
 * shape used to end in `& Record<string, unknown>`, which made every property
 * access legal — `requireSupplierContactAndLocaton` compiled, read `undefined`,
 * and silently dropped whatever it gated. Add a column here when a component
 * needs it; never widen.
 *
 * `Partial` because a provider may hand down a SUBSET (the public quote share
 * page supplies only the three settings that page renders), so every consumer
 * must still tolerate `undefined`.
 */
type CompanySettings = Partial<
  Pick<
    Database["public"]["Tables"]["companySettings"]["Row"],
    | "allowLowercaseItemIds"
    | "digitalQuoteEnabled"
    | "digitalQuoteIncludesPurchaseOrders"
    | "showCurrencyTrailingZeros"
    | "showCustomerReadableId"
    | "showSupplierReadableId"
  >
>;

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
