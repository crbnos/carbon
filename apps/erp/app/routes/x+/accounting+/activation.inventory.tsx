// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { SetupBody, SetupSection } from "~/components/Setup";
import {
  getActivationCutover,
  getCutoverInventory
} from "~/modules/accounting/accounting.server";
import {
  ActivationFooter,
  InventoryCostTable
} from "~/modules/accounting/ui/Activation";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Inventory`,
  to: path.to.accountingActivationStep("inventory")
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });
  const { cutoverDate } = await getActivationCutover(
    client,
    companyId,
    request
  );
  const items = await getCutoverInventory(getDatabaseClient(), {
    companyId,
    cutoverDate
  });
  return { cutoverDate, items };
}

/** Step 2: the stock the enable opens with, and the cost of each item. */
export default function AccountingActivationInventoryRoute() {
  const { cutoverDate, items } = useLoaderData<typeof loader>();

  return (
    <>
      <SetupBody>
        <SetupSection
          title={<Trans>Inventory</Trans>}
          description={
            <Trans>
              The enable resets each item's stock to its on-hand quantity at the
              cutover date, at the unit cost below. Review the cost of every
              Average item.
            </Trans>
          }
        >
          <InventoryCostTable items={items} />
        </SetupSection>
      </SetupBody>
      <ActivationFooter step="inventory" cutoverDate={cutoverDate} />
    </>
  );
}
