import { requirePermissions } from "@carbon/auth/auth.server";
import { storage } from "@carbon/files";
import { Trans } from "@lingui/react/macro";
import type { FileObject } from "@supabase/storage-js";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import DefaultAttachmentsPanel from "~/components/DefaultAttachmentsPanel";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });
  const { supplierId } = params;
  if (!supplierId) throw new Error("Missing supplierId");

  const result = await storage(client)
    .company(companyId)
    .list(`${companyId}/default-attachments/supplier/${supplierId}`);

  return {
    supplierId,
    // the union helper's structural type omits supabase's FileObject fields
    files: (result.data ?? []) as FileObject[]
  };
}

export default function SupplierDefaultAttachmentsRoute() {
  const { supplierId, files } = useLoaderData<typeof loader>();

  return (
    <DefaultAttachmentsPanel
      files={files}
      storagePathPrefix={`default-attachments/supplier/${supplierId}`}
      title={<Trans>Default Attachments</Trans>}
      description={
        <Trans>
          Files attached here ride along on every purchase order email sent to
          this supplier (in addition to company-wide defaults).
        </Trans>
      }
    />
  );
}
