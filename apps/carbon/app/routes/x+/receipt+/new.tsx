import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { getSupabaseServiceRole } from "~/lib/supabase";
import type { ReceiptSourceDocument } from "~/modules/inventory";
import { getUserDefaults } from "~/modules/users/users.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Receipts",
  to: path.to.receipts,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory",
  });

  const url = new URL(request.url);
  const sourceDocument =
    (url.searchParams.get("sourceDocument") as ReceiptSourceDocument) ??
    undefined;
  const sourceDocumentId = url.searchParams.get("sourceDocumentId") ?? "";

  const defaults = await getUserDefaults(client, userId, companyId);

  const serviceRole = getSupabaseServiceRole();
  switch (sourceDocument) {
    case "Purchase Order":
      const purchaseOrderReceipt = await serviceRole.functions.invoke<{
        id: string;
      }>("create-receipt-from-purchase-order", {
        body: {
          companyId,
          locationId: defaults.data?.locationId,
          purchaseOrderId: sourceDocumentId,
          receiptId: undefined,
          userId: userId,
        },
      });
      if (!purchaseOrderReceipt.data || purchaseOrderReceipt.error) {
        throw redirect(
          path.to.purchaseOrder(sourceDocumentId),
          await flash(
            request,
            error(purchaseOrderReceipt.error, "Failed to create receipt")
          )
        );
      }

      throw redirect(path.to.receiptLines(purchaseOrderReceipt.data.id));
    default:
      const defaultReceipt = await serviceRole.functions.invoke<{
        id: string;
      }>("create-receipt-default", {
        body: {
          companyId,
          locationId: defaults.data?.locationId,
          userId: userId,
        },
      });
      if (!defaultReceipt.data || defaultReceipt.error) {
        throw redirect(
          path.to.receipts,
          await flash(request, error(error, "Failed to create receipt"))
        );
      }

      throw redirect(path.to.receiptDetails(defaultReceipt.data.id));
  }
}
