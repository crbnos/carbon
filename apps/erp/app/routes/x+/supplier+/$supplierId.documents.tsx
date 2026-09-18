import { requirePermissions } from "@carbon/auth/auth.server";
import { listCompanyPrivateObjects } from "@carbon/utils";
import type { FileObject } from "@supabase/storage-js";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import RecordDocuments from "~/components/RecordDocuments";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Missing supplierId");

  const result = await listCompanyPrivateObjects({
    storage: client.storage,
    companyId,
    prefix: `${companyId}/supplier/${supplierId}`
  });

  return {
    supplierId,
    // The union helper types entries as StorageFileLike; at runtime they are
    // the supabase FileObjects RecordDocuments expects.
    files: result.data as unknown as FileObject[]
  };
}

export default function SupplierDocumentsRoute() {
  const { supplierId, files } = useLoaderData<typeof loader>();

  return (
    <RecordDocuments
      files={files}
      id={supplierId}
      bucketPrefix="supplier"
      sourceDocument="Supplier"
      module="purchasing"
    />
  );
}
