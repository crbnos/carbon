// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { New } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { IntercompanyTransactionTable } from "~/modules/accounting/ui/Intercompany";
import type { Handle } from "~/utils/handle";
import { intercompanyTransactionsList } from "~/utils/list-registry/accounting.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Intercompany`,
  to: path.to.intercompany
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, intercompanyTransactionsList, {
    dataKey: "data"
  });
}

export default function IntercompanyRoute() {
  const { t } = useLingui();
  const { data, count, infinite } = useLoaderData<typeof loader>();
  const [params] = useUrlParams();
  const permissions = usePermissions();
  const matchFetcher = useFetcher();
  const eliminateFetcher = useFetcher();
  const regenerateFetcher = useFetcher();

  return (
    <VStack spacing={0} className="h-full">
      <IntercompanyTransactionTable
        data={data}
        count={count}
        infinite={infinite}
        primaryAction={
          permissions.can("create", "accounting") && (
            <div className="flex items-center gap-2">
              <matchFetcher.Form method="post" action="match">
                <Button
                  variant="secondary"
                  type="submit"
                  isLoading={matchFetcher.state !== "idle"}
                >
                  Run Matching
                </Button>
              </matchFetcher.Form>
              <eliminateFetcher.Form method="post" action="eliminate">
                <Button
                  variant="secondary"
                  type="submit"
                  isLoading={eliminateFetcher.state !== "idle"}
                >
                  Generate Eliminations
                </Button>
              </eliminateFetcher.Form>
              <regenerateFetcher.Form method="post" action="eliminate">
                <input type="hidden" name="regenerate" value="true" />
                <Button
                  variant="secondary"
                  type="submit"
                  isLoading={regenerateFetcher.state !== "idle"}
                >
                  Regenerate
                </Button>
              </regenerateFetcher.Form>
              <New label={t`IC Transaction`} to={`new?${params.toString()}`} />
            </div>
          )
        }
      />
      <RecordOutlet />
    </VStack>
  );
}
