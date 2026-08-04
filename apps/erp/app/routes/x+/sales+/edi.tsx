import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getEdiDocuments } from "~/modules/sales";
import EdiDocumentsTable from "~/modules/sales/ui/Edi/EdiDocumentsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`EDI`,
  to: path.to.ediDocuments
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const type = searchParams.get("type");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const documents = await getEdiDocuments(client, companyId, {
    search,
    status,
    type,
    limit,
    offset,
    sorts,
    filters
  });

  if (documents.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(documents.error, "Error loading EDI documents")
      )
    );
  }

  return {
    documents: documents.data ?? [],
    count: documents.count ?? 0
  };
}

export default function EdiDocumentsRoute() {
  const { documents, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <EdiDocumentsTable data={documents} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
