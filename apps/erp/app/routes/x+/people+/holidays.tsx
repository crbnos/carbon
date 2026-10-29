// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getHolidayYears } from "~/modules/people/people.service";
import { HolidaysTable } from "~/modules/people/ui/Holidays";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { holidaysList } from "~/utils/list-registry/people.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Holidays`,
  to: path.to.holidays
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, holidaysList, {
    dataKey: "holidays",
    bypassRls: true,
    firstPage: async ({ client, companyId }) => {
      const years = await getHolidayYears(client, companyId);
      return {
        years:
          years.data?.map((d) => d.year as number).sort((a, b) => b - a) ?? []
      };
    },
    onError: { redirectTo: path.to.people, message: "Failed to load holidays" }
  });
}

export default function Route() {
  const { holidays, years, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <HolidaysTable
        data={holidays}
        count={count}
        infinite={infinite}
        years={years}
      />
      <RecordOutlet />
    </VStack>
  );
}
