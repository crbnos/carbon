import { requirePermissions } from "@carbon/auth/auth.server";
import {
  getAccountingIntegration,
  getProviderIntegration,
  ProviderID,
  type XeroProvider
} from "@carbon/ee/accounting";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

/**
 * GET: Fetch chart of accounts from Xero
 * Returns accounts formatted for use in select dropdowns
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  try {
    // Get Xero integration
    const integration = await getAccountingIntegration(
      client,
      companyId,
      ProviderID.XERO
    );

    // Create provider instance
    const provider = getProviderIntegration(
      client,
      companyId,
      integration.id,
      integration.metadata
    ) as XeroProvider;

    // Fetch accounts from Xero
    const accounts = await provider.listChartOfAccounts();

    // Format accounts for dropdown options
    const options = accounts.map((account) => ({
      value: account.Code ?? account.AccountID,
      label: account.Code ? `${account.Code} - ${account.Name}` : account.Name,
      description: account.Type,
      // Include metadata for filtering
      type: account.Type,
      class: account.Class
    }));

    return data({ accounts: options });
  } catch (error) {
    console.error("Failed to fetch Xero accounts:", error);
    return data(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch accounts",
        accounts: []
      },
      { status: 500 }
    );
  }
}
