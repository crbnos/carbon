import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getQualityDocuments } from "~/modules/quality";
import QualityDocumentsTable from "~/modules/quality/ui/Documents/QualityDocumentsTable";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Policy & Procedure",
  to: path.to.qualityDocuments
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

  const [qualityDocuments, tags] = await Promise.all([
    getQualityDocuments(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getTagsList(client, companyId, "qualityDocument")
  ]);

  return {
    qualityDocuments: qualityDocuments.data ?? [],
    count: qualityDocuments.count ?? 0,
    tags: tags.data ?? []
  };
}

export default function QualityDocumentsRoute() {
  const { qualityDocuments, count, tags } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <QualityDocumentsTable
        data={qualityDocuments}
        count={count}
        tags={tags}
      />
      <Outlet />
    </VStack>
  );
}
