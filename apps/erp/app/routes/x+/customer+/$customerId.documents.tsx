import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import RecordDocuments from "~/components/RecordDocuments";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Missing customerId");

  const result = await client.storage
    .from("private")
    .list(`${companyId}/customer/${customerId}`);

  return {
    customerId,
    files: result.data ?? []
  };
}

export default function CustomerDocumentsRoute() {
  const { customerId, files } = useLoaderData<typeof loader>();

  return (
    <RecordDocuments
      files={files}
      id={customerId}
      bucketPrefix="customer"
      sourceDocument="Customer"
      module="sales"
    />
  );
}
