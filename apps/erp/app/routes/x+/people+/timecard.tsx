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
import { TimecardsTable } from "~/modules/people/ui/Timecards";
import { getCompanySettings } from "~/modules/settings/settings.service";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { timecardEntriesList } from "~/utils/list-registry/people.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Timecards`,
  to: path.to.peopleTimecard
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, timecardEntriesList, {
    dataKey: "entries",
    guard: async ({ client, companyId, request }) => {
      const companySettings = await getCompanySettings(client, companyId);
      if (!companySettings.data?.timeCardEnabled) {
        throw redirect(
          path.to.people,
          await flash(
            request,
            error(
              null,
              "Timecards are not enabled. To enable this feature, go to Settings → People to enable Timecards."
            )
          )
        );
      }
    },
    onError: {
      redirectTo: path.to.people,
      message: "Failed to load timecard entries"
    }
  });
}

export default function Route() {
  const { entries, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <TimecardsTable data={entries} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
