import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { TrainingsTable } from "~/modules/resources";
import { getTrainings } from "~/modules/resources/resources.service.server";
import { getTagsList } from "~/modules/shared/shared.service.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Training`,
  to: path.to.trainings
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [trainings, tags] = await Promise.all([
    getTrainings({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getTagsList("training")
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
    trainings: trainings.data ?? [],
    count: trainings.count ?? 0,
    tags: tags.data ?? []
  };
}

export default function TrainingsRoute() {
  const { trainings, count, tags } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <TrainingsTable data={trainings} count={count} tags={tags} />
      <Outlet />
    </VStack>
  );
}
