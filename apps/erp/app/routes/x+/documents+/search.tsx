import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ResizablePanel, ResizablePanelGroup, VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
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
  const { userId } = await requirePermissions(request, {
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

  const [documents, labels, extensions] = await Promise.all([
    getDocuments({
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
    getDocumentLabels(),
    getDocumentExtensions()
  ]);

  if (documents.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(request, error(documents.error, "Failed to fetch documents"))
    );
  }

  return {
    count: documents.count ?? 0,
    documents: (documents.data ?? []) as Document[],
    labels: labels.data ?? [],
    extensions: extensions.data?.map(({ extension }) => extension) ?? []
  };
}

export default function DocumentsAllRoute() {
  const { count, documents, labels, extensions } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full ">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel>
          <DocumentsTable
            data={documents}
            count={count}
            labels={labels}
            extensions={extensions}
          />
        </ResizablePanel>
        <Outlet />
      </ResizablePanelGroup>
    </VStack>
  );
}
