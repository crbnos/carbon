// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { MemosTable } from "~/modules/invoicing/ui";
import type { Handle } from "~/utils/handle";
import { creditMemosList } from "~/utils/list-registry/invoicing.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

// Accounts Receivable — customer credit/debit memos. The supplier side lives in
// supplier-credits.tsx; both read the same `memo` table, scoped by party.
export const handle: Handle = {
  breadcrumb: msg`Credit Memos`,
  to: path.to.creditMemos,
  module: "invoicing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, creditMemosList, {
    dataKey: "memos",
    onError: {
      redirectTo: path.to.invoicing,
      message: "Failed to fetch credit memos"
    }
  });
}

export default function CreditMemosRoute() {
  const { count, memos, infinite } = useLoaderData<typeof loader>();
  return (
    <MemosTable
      data={memos}
      count={count}
      infinite={infinite}
      party="customer"
    />
  );
}
