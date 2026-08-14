import { requirePermissions } from "@carbon/auth/auth.server";
import { listAvalaraCompanies } from "@carbon/ee/avalara";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

/**
 * GET: list the Avalara companies for the configured account, formatted as
 * select options for the `companyCode` dynamic field. Degrades to an empty
 * list on any error so the settings page never crashes.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const { data: companies, error: listError } = await listAvalaraCompanies(
    client,
    companyId
  );
  if (listError || !companies) {
    return data({ companies: [], error: listError?.message ?? null });
  }

  const options = companies.map((company) => ({
    value: company.companyCode,
    label: company.name
      ? `${company.name} (${company.companyCode})`
      : company.companyCode
  }));

  return data({ companies: options, error: null });
}
