// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { getRecentFederationExchanges } from "~/modules/settings/settings.service";

const logger = getLogger("erp", "federation-rule-exchanges");

// Polled by the Connect workload Test step: a rule's latest exchange attempts.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "users"
  });
  const { ruleId } = params;
  if (!ruleId) throw new Response("Rule not found", { status: 404 });

  const exchanges = await getRecentFederationExchanges(
    client,
    ruleId,
    companyId
  );
  if (exchanges.error) {
    logger.error("Failed to read federation exchanges", {
      companyId,
      ruleId,
      error: exchanges.error
    });
  }
  return { exchanges: exchanges.data ?? [] };
}
