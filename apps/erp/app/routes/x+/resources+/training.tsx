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
import { TrainingsTable } from "~/modules/resources/ui";
import { getTagsList } from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { trainingsList } from "~/utils/list-registry/resources.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Training`,
  to: path.to.trainings
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, trainingsList, {
    dataKey: "trainings",
    firstPage: async ({ client, companyId, request }) => {
      const tags = await getTagsList(client, companyId, "training");
      if (tags.error) {
        throw redirect(
          path.to.authenticatedRoot,
          await flash(request, error(tags.error, "Error loading tags"))
        );
      }
      return { tags: tags.data ?? [] };
    },
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Error loading trainings"
    }
  });
}

export default function TrainingsRoute() {
  const { trainings, count, infinite, tags } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <TrainingsTable
        data={trainings}
        count={count}
        infinite={infinite}
        tags={tags}
      />
      <RecordOutlet />
    </VStack>
  );
}
