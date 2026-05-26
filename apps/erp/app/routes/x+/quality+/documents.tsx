import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getQualityDocuments } from "~/modules/quality/quality.service.server";
import QualityDocumentsTable from "~/modules/quality/ui/Documents/QualityDocumentsTable";
import { getTagsList } from "~/modules/shared/shared.service.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Quality Documents`,
  to: path.to.qualityDocuments
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [qualityDocuments, tags] = await Promise.all([
    getQualityDocuments({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getTagsList("qualityDocument")
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
