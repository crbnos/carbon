// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import QualityDocumentsTable from "~/modules/quality/ui/Documents/QualityDocumentsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Quality Documents`,
  to: path.to.qualityDocuments
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(
    request,
    { "quality.qualityDocuments": "View" },
    { role: "employee" }
  );

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [qualityDocuments, tags] = await Promise.all([
    api.quality.getQualityDocuments({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    api.shared.getTagsList({ table: "qualityDocument" })
  ]);

  return {
    qualityDocuments: qualityDocuments.data?.rows ?? [],
    count: qualityDocuments.data?.count ?? 0,
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
      <RecordOutlet />
    </VStack>
  );
}
