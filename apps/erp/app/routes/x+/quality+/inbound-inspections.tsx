import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getInboundInspections } from "~/modules/quality/quality.service.server";
import InboundInspectionsTable from "~/modules/quality/ui/InboundInspections/InboundInspectionsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Inbound Inspections`,
  to: path.to.inboundInspections
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const inspections = await getInboundInspections({
    search,
    status,
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

export default function InboundInspectionsRoute() {
  const { inspections, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <InboundInspectionsTable data={inspections} count={count} />
      <Outlet />
    </VStack>
  );
}
