import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getInspections } from "~/modules/quality";
import InspectionsTable from "~/modules/quality/ui/Inspections/InspectionsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Inspections`,
  to: path.to.inspections
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const source = searchParams.get("source");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const inspections = await getInspections(client, companyId, {
    search,
    status,
    source,
    limit,
    offset,
    sorts,
    filters
  });

  if (inspections.error) {
    throw redirect(
      path.to.quality,
      await flash(
        request,
        error(inspections.error, "Failed to load inspections")
      )
    );
  }

  return {
    inspections: inspections.data ?? [],
    count: inspections.count ?? 0
  };
}

export default function InspectionsRoute() {
  const { inspections, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <InspectionsTable data={inspections} count={count} />
      <Outlet />
    </VStack>
  );
}
