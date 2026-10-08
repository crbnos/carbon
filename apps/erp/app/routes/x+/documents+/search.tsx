// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { generateDownloadToken } from "@carbon/auth/download-token.server";
import { flash } from "@carbon/auth/session.server";
import {
  RecordOutlet,
  ResizablePanel,
  ResizablePanelGroup,
  VStack
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useResolved } from "~/hooks/useResolved";
import type { Document } from "~/modules/documents";
import {
  DocumentsTable,
  getDocumentExtensions,
  getDocumentLabels,
  getDocuments
} from "~/modules/documents";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "documents"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const filter = searchParams.get("q");

  const createdBy = filter === "my" ? userId : undefined;
  const favorite = filter === "starred" ? true : undefined;
  const recent = filter === "recent" ? true : undefined;
  const active = filter === "trash" ? false : true;

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  // Only the file-type filter needs this, so it streams rather than holding
  // the page.
  const extensions = getDocumentExtensions(client, companyId).then(
    (result) => result.data?.map(({ extension }) => extension) ?? []
  );

  const [documents, labels] = await Promise.all([
    getDocuments(client, companyId, {
      search,
      favorite,
      recent,
      createdBy,
      active,
      limit,
      offset,
      sorts,
      filters
    }),
    getDocumentLabels(client, userId)
  ]);

  if (documents.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(request, error(documents.error, "Failed to fetch documents"))
    );
  }

  // Mint a signed download token per file-backed row. Signing is a server-only
  // HS256 op over the current result set (the same set the CSV exports).
  const documentsWithDownloadTokens: Document[] = await Promise.all(
    (documents.data ?? []).map(async (document) => ({
      ...document,
      downloadToken:
        document.id && document.path
          ? await generateDownloadToken({
              userId,
              companyId,
              documentId: document.id
            })
          : undefined
    }))
  );

  return {
    count: documents.count ?? 0,
    documents: documentsWithDownloadTokens,
    labels: labels.data ?? [],
    extensions
  };
}

export default function DocumentsAllRoute() {
  const { count, documents, labels, ...data } = useLoaderData<typeof loader>();
  const extensions = useResolved(data.extensions, []);

  return (
    <VStack spacing={0} className="h-full ">
      <ResizablePanelGroup direction="horizontal" stackOnCompact>
        <ResizablePanel>
          <DocumentsTable
            data={documents}
            count={count}
            labels={labels}
            extensions={extensions}
          />
        </ResizablePanel>
        <RecordOutlet />
      </ResizablePanelGroup>
    </VStack>
  );
}
