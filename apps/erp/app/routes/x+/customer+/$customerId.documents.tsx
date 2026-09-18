import { requirePermissions } from "@carbon/auth/auth.server";
import { listCompanyPrivateObjects } from "@carbon/utils";
import type { FileObject } from "@supabase/storage-js";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import RecordDocuments from "~/components/RecordDocuments";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Missing customerId");

  const result = await listCompanyPrivateObjects({
    storage: client.storage,
    companyId,
    prefix: `${companyId}/customer/${customerId}`
  });

  return {
    customerId,
    // The union helper types entries as StorageFileLike; at runtime they are
    // the supabase FileObjects RecordDocuments expects.
    files: result.data as unknown as FileObject[]
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
