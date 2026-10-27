// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { MemosTable } from "~/modules/invoicing/ui";
import type { Handle } from "~/utils/handle";
import { supplierCreditsList } from "~/utils/list-registry/invoicing.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

// Accounts Payable — supplier credit/debit memos. The customer side lives in
// credit-memos.tsx; both read the same `memo` table, scoped by party.
export const handle: Handle = {
  breadcrumb: msg`Supplier Credits`,
  to: path.to.supplierCredits,
  module: "invoicing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, supplierCreditsList, {
    dataKey: "memos",
    onError: {
      redirectTo: path.to.invoicing,
      message: "Failed to fetch supplier credits"
    }
  });
}

export default function SupplierCreditsRoute() {
  const { count, memos, infinite } = useLoaderData<typeof loader>();
  return (
    <MemosTable
      data={memos}
      count={count}
      infinite={infinite}
      party="supplier"
    />
  );
}
