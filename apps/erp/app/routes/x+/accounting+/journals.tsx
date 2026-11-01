// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCirclePlus } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { NewAction } from "~/components/New";
import { usePermissions } from "~/hooks";
import { JournalEntriesTable } from "~/modules/accounting/ui/JournalEntries";
import type { Handle } from "~/utils/handle";
import { journalEntriesList } from "~/utils/list-registry/accounting.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Journal Entries`,
  to: path.to.accountingJournals
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, journalEntriesList, { dataKey: "data" });
}

function NewJournalEntry() {
  const { t } = useLingui();
  const fetcher = useFetcher();
  return (
    <NewAction
      label={t`Add Journal Entry`}
      isDisabled={fetcher.state !== "idle"}
      onClick={() => fetcher.submit(null, { method: "post", action: "new" })}
    >
      <fetcher.Form method="post" action="new">
        <Button
          type="submit"
          leftIcon={<LuCirclePlus />}
          variant="primary"
          isLoading={fetcher.state !== "idle"}
        >
          <Trans>Add Journal Entry</Trans>
        </Button>
      </fetcher.Form>
    </NewAction>
  );
}

export default function JournalEntriesRoute() {
  const { data, count, infinite } = useLoaderData<typeof loader>();
  const permissions = usePermissions();

  return (
    <VStack spacing={0} className="h-full">
      <JournalEntriesTable
        data={data}
        count={count}
        infinite={infinite}
        primaryAction={
          permissions.can("create", "accounting") && <NewJournalEntry />
        }
      />
      <RecordOutlet />
    </VStack>
  );
}
