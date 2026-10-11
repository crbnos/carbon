// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCirclePlus } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { NewAction } from "~/components/New";
import { usePermissions } from "~/hooks";
import { getJournalEntries } from "~/modules/accounting";
import { JournalEntriesTable } from "~/modules/accounting/ui/JournalEntries";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Journal Entries`,
  to: path.to.accountingJournals
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const entries = await getJournalEntries(client, companyId, {
    search,
    status,
    limit,
    offset,
    sorts,
    filters
  });

  return {
    data: entries.data ?? [],
    count: entries.count ?? 0
  };
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
  const { data, count } = useLoaderData<typeof loader>();
  const permissions = usePermissions();

  return (
    <VStack spacing={0} className="h-full">
      <JournalEntriesTable
        data={data}
        count={count}
        primaryAction={
          permissions.can("create", "accounting") && <NewJournalEntry />
        }
      />
      <RecordOutlet />
    </VStack>
  );
}
