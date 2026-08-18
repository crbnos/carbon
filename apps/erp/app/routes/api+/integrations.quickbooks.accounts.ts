import { requirePermissions } from "@carbon/auth/auth.server";
import {
  getAccountingIntegration,
  getProviderIntegration,
  ProviderID,
  type QboProvider
} from "@carbon/ee/accounting";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

/**
 * GET: Fetch chart of accounts from QuickBooks Online
 * Returns accounts formatted for use in select dropdowns
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  try {
    // Get QuickBooks Online integration
    const integration = await getAccountingIntegration(
      client,
      companyId,
      ProviderID.QUICKBOOKS
    );

    // Create provider instance
    const provider = getProviderIntegration(
      client,
      companyId,
      integration.id,
      integration.metadata
    ) as QboProvider;

    // Fetch accounts from QuickBooks Online — already normalized to
    // { id, code, name } with code = AcctNum ?? Id (QBO account numbers
    // are optional)
    const accounts = await provider.listChartOfAccounts();

    // Format accounts for dropdown options. QBO references accounts by Id
    // (the account mapping stores Id as externalId), so Id is the value;
    // the label shows the account number only when one is assigned.
    const options = accounts.map((account) => ({
      value: account.id,
      label:
        account.code !== account.id
          ? `${account.code} - ${account.name}`
          : account.name
    }));

    return data({ accounts: options });
  } catch (error) {
    console.error("Failed to fetch QuickBooks Online accounts:", error);
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
