// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { generateDownloadToken } from "@carbon/auth/download-token.server";
import {
  RecordOutlet,
  ResizablePanel,
  ResizablePanelGroup,
  VStack
} from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useResolved } from "~/hooks/useResolved";
import {
  getDocumentExtensions,
  getDocumentLabels
} from "~/modules/documents/documents.service";
import type { Document } from "~/modules/documents/types";
import { DocumentsTable } from "~/modules/documents/ui";
import {
  documentsList,
  recentDocumentsList
} from "~/utils/list-registry/documents.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  // The "Recent" view orders by the last activity, so it is its own list.
  const list =
    new URL(request.url).searchParams.get("q") === "recent"
      ? recentDocumentsList
      : documentsList;

  return loadListPage(request, list, {
    dataKey: "documents",
    firstPage: async ({ client, companyId, userId }) => ({
      labels: (await getDocumentLabels(client, userId)).data ?? [],
      // Only the file-type filter needs this, so it streams rather than
      // holding the page.
      extensions: getDocumentExtensions(client, companyId).then(
        (result) => result.data?.map(({ extension }) => extension) ?? []
      )
    }),
    // A signed download token per file-backed row. Signing is a server-only
    // HS256 op. Each page mints its own, so every loaded row carries one.
    mapRows: (documents, { companyId, userId }) =>
      Promise.all(
        (documents as Document[]).map(
          async (document): Promise<Document> => ({
            ...document,
            downloadToken:
              document.id && document.path
                ? await generateDownloadToken({
                    userId,
                    companyId,
                    documentId: document.id
                  })
                : undefined
          })
        )
      ),
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Failed to fetch documents"
    }
  });
}

export default function DocumentsAllRoute() {
  const { count, documents, infinite, labels, ...data } =
    useLoaderData<typeof loader>();
  const extensions = useResolved(data.extensions, []);

  return (
    <VStack spacing={0} className="h-full ">
      <ResizablePanelGroup direction="horizontal" stackOnCompact>
        <ResizablePanel>
          <DocumentsTable
            data={documents}
            count={count}
            infinite={infinite}
            labels={labels}
            extensions={extensions}
          />
        </ResizablePanel>
        <RecordOutlet />
      </ResizablePanelGroup>
    </VStack>
  );
}
