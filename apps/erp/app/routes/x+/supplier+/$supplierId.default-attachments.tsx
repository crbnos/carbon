import { requirePermissions } from "@carbon/auth/auth.server";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import DefaultAttachmentsPanel from "~/components/DefaultAttachmentsPanel";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });
  const { supplierId } = params;
  if (!supplierId) throw new Error("Missing supplierId");

  const result = await client.storage
    .from("private")
    .list(`${companyId}/default-attachments/supplier/${supplierId}`);

  return {
    supplierId,
    files: result.data ?? []
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
