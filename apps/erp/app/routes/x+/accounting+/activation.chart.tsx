// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { Button } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { LuFileUp } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { SetupBody, SetupSection } from "~/components/Setup";
import { getActivationCutover } from "~/modules/accounting/accounting.server";
import { ActivationFooter } from "~/modules/accounting/ui/Activation";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Chart of Accounts`,
  to: path.to.accountingActivationStep("chart")
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });
  return getActivationCutover(client, companyId, request);
}

/** Step 1: bring in the company's own chart before the trial balance, which
 *  is matched to it by account number. */
export default function AccountingActivationChartRoute() {
  const { cutoverDate } = useLoaderData<typeof loader>();

  return (
    <>
      <SetupBody>
        <SetupSection
          title={<Trans>Chart of Accounts</Trans>}
          description={
            <Trans>
              Carbon starts every company on its default chart. Import your own
              chart now, before the trial balance, which matches accounts by
              number. The import needs two files: your chart, and the default
              accounts template filled with your account numbers. To keep
              Carbon's chart, continue.
            </Trans>
          }
          actions={
            <Button leftIcon={<LuFileUp />} asChild>
              <Link to={`${path.to.chartOfAccountsImport}?from=activation`}>
                <Trans>Import your chart</Trans>
              </Link>
            </Button>
          }
        />
      </SetupBody>
      <ActivationFooter step="chart" cutoverDate={cutoverDate} />
    </>
  );
}
