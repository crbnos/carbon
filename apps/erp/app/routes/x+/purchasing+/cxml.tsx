import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getCxmlDocuments } from "~/modules/purchasing";
import { CxmlDocumentsTable } from "~/modules/purchasing/ui/Cxml";
import { getGenericQueryFilters } from "~/utils/query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const documents = await getCxmlDocuments(client, companyId, {
    limit,
    offset,
    sorts,
    filters,
    status: searchParams.get("status"),
    documentType: searchParams.get("documentType")
  });

  return {
    data: documents.data ?? [],
    count: documents.count ?? 0
  };
}

export default function CxmlDocumentsRoute() {
  const { data, count } = useLoaderData<typeof loader>();
  return (
    <VStack spacing={0} className="h-full">
      <CxmlDocumentsTable data={data} count={count} />
      <Outlet />
    </VStack>
  );
}
