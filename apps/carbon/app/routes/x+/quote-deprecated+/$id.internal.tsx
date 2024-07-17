import { useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { QuotationAttachment } from "~/modules/sales";
import { QuotationDocuments } from "~/modules/sales";
import { path } from "~/utils/path";

export function action() {
  // used for reloading the data via fetcher.submit(null, { method: 'post'})
  return null;
}

export default function QuotationInternalDocumentsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    internalDocuments: QuotationAttachment[];
  }>(path.to.quote(id));

  return (
    <QuotationDocuments
      attachments={routeData?.internalDocuments ?? []}
      isExternal={false}
      id={id}
    />
  );
}
