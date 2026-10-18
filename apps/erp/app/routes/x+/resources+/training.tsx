// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { TrainingsTable } from "~/modules/resources/ui";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Training`,
  to: path.to.trainings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "resources",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [trainings, tags] = await Promise.all([
    api.resources.getTrainings({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    api.shared.getTagsList({ table: "training" })
  ]);

  if (trainings.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(trainings.error, "Error loading trainings"))
    );
  }

  if (tags.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(tags.error, "Error loading tags"))
    );
  }

  return {
    trainings: trainings.data?.rows ?? [],
    count: trainings.data?.count ?? 0,
    tags: tags.data ?? []
  };
}

export default function TrainingsRoute() {
  const { trainings, count, tags } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <TrainingsTable data={trainings} count={count} tags={tags} />
      <RecordOutlet />
    </VStack>
  );
}
