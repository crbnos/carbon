// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getAccountsList } from "~/modules/accounting/accounting.service";
import { ItemPostingGroupsTable } from "~/modules/items/ui/ItemPostingGroups";
import type { Handle } from "~/utils/handle";
import { itemPostingGroupsList } from "~/utils/list-registry/items.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Item Groups`,
  to: path.to.itemPostingGroups
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, itemPostingGroupsList, {
    dataKey: "itemPostingGroups",
    firstPage: async ({ client, companyGroupId }) => {
      const accounts = await getAccountsList(client, companyGroupId);
      if (accounts.error) {
        throw redirect(
          path.to.itemPostingGroups,
          await flash(request, error(accounts.error, "Error loading accounts"))
        );
      }
      return { accounts: accounts.data ?? [] };
    },
    onError: {
      redirectTo: path.to.items,
      message: "Error loading item groups"
    }
  });
}

export default function ItemPostingGroupsRoute() {
  const { itemPostingGroups, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ItemPostingGroupsTable
        data={itemPostingGroups}
        count={count}
        infinite={infinite}
      />
      <RecordOutlet />
    </VStack>
  );
}
