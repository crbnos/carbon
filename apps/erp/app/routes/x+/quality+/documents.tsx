import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getQualityDocuments } from "~/modules/quality";
import QualityDocumentsTable from "~/modules/quality/ui/Documents/QualityDocumentsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Documents",
  to: path.to.qualityDocuments,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const qualityDocuments = await getQualityDocuments(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters,
  });

  return json({
    qualityDocuments: qualityDocuments.data ?? [],
    count: qualityDocuments.count ?? 0,
  });
}

export default function QualityDocumentsRoute() {
  const { qualityDocuments, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <QualityDocumentsTable data={qualityDocuments} count={count} />
      <Outlet />
    </VStack>
  );
}
