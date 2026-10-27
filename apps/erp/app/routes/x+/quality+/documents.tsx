// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import QualityDocumentsTable from "~/modules/quality/ui/Documents/QualityDocumentsTable";
import { getTagsList } from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { qualityDocumentsList } from "~/utils/list-registry/quality.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Quality Documents`,
  to: path.to.qualityDocuments
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, qualityDocumentsList, {
    dataKey: "qualityDocuments",
    firstPage: async ({ client, companyId }) => ({
      tags: (await getTagsList(client, companyId, "qualityDocument")).data ?? []
    })
  });
}

export default function QualityDocumentsRoute() {
  const { qualityDocuments, count, infinite, tags } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <QualityDocumentsTable
        data={qualityDocuments}
        count={count}
        infinite={infinite}
        tags={tags}
      />
      <RecordOutlet />
    </VStack>
  );
}
