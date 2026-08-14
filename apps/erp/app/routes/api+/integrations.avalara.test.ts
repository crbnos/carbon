import { requirePermissions } from "@carbon/auth/auth.server";
import { getAvalaraClient } from "@carbon/ee/avalara";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

/**
 * POST: uncached Avalara health probe. Runs the same checks as `onHealthcheck`
 * (ping + company-code resolution) and returns a JSON result the Test
 * Connection button surfaces as a toast. The license key is never included in
 * the response — only the taxonomy `kind` is mapped to a human message.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const { data: avalara, error: clientError } = await getAvalaraClient(
    client,
    companyId
  );

  if (clientError || !avalara) {
    return data(
      { error: clientError?.message ?? "Avalara is not configured" },
      { status: 400 }
    );
  }

  const ping = await avalara.avatax.ping();
  if (ping.error) {
    return data({ error: mapReason(ping.error.kind) }, { status: 400 });
  }

  const company = await avalara.avatax.getCompanyByCode(
    avalara.config.companyCode
  );
  if (company.error || !company.data) {
    return data(
      { error: mapReason(company.error?.kind ?? "not_found") },
      { status: 400 }
    );
  }

  return data({
    success: true,
    message: `Connected to Avalara — company "${company.data.name}" (${avalara.config.environment})`
  });
}

function mapReason(kind: string): string {
  switch (kind) {
    case "auth":
      return "Invalid Avalara credentials";
    case "not_found":
      return "Company code not found in Avalara";
    case "validation":
      return "Avalara rejected the request";
    case "rate_limit":
      return "Avalara rate limit exceeded — try again shortly";
    case "not_configured":
      return "Avalara is not configured";
    default:
      return "Avalara is unreachable — try again shortly";
  }
}
