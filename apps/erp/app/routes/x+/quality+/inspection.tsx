import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getInspectionDocuments } from "~/modules/quality";
import { InspectionDocumentTable } from "~/modules/quality/ui/InspectionDocument";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Quality`,
  to: path.to.quality
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const diagrams = await getInspectionDocuments(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });

  return {
    diagrams: diagrams.data ?? [],
    count: diagrams.count ?? 0
  };
}

export default function InspectionDocumentsRoute() {
  const { diagrams, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <InspectionDocumentTable data={diagrams} count={count} />
      <Outlet />
    </VStack>
  );
}
