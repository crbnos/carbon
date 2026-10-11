// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getIndirectPools } from "@carbon/ee/indirect-rates.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import {
  IndirectPoolsTable,
  IndirectRatesUpgradeOverlay
} from "~/modules/accounting/ui/IndirectRates";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "indirect-pools");

export const handle: Handle = {
  breadcrumb: msg`Indirect Pools`,
  to: path.to.indirectPools
};

// The list loads without a plan check: a gated company sees the upgrade
// overlay. The write routes and the ee authoring functions enforce the plan.
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const pools = await getIndirectPools(client, companyId);
  if (pools.error) {
    logger.error("Failed to load the indirect pools", {
      companyId,
      error: pools.error
    });
    throw redirect(
      path.to.accounting,
      await flash(request, error(pools.error, "Failed to load indirect pools"))
    );
  }

  return { pools: pools.data ?? [] };
}

export default function IndirectPoolsRoute() {
  const { pools } = useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "GOVERNMENT_CONTRACTING" });

  if (isGated) {
    return <IndirectRatesUpgradeOverlay />;
  }

  return (
    <VStack spacing={0} className="h-full">
      <IndirectPoolsTable data={pools} count={pools.length} />
      <RecordOutlet />
    </VStack>
  );
}
