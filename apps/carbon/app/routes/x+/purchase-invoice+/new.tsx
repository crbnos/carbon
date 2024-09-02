import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import type { FunctionsResponse } from "@supabase/functions-js";
import { useUrlParams } from "~/hooks";
import type { PurchaseInvoiceStatus } from "~/modules/invoicing";
import {
  PurchaseInvoiceForm,
  purchaseInvoiceValidator,
  upsertPurchaseInvoice,
} from "~/modules/invoicing";
import { createPurchaseInvoiceFromPurchaseOrder } from "~/modules/invoicing/invoicing.server";
import { getNextSequence, rollbackNextSequence } from "~/modules/settings";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Purchasing",
  to: path.to.purchaseInvoices,
};

export async function loader({ request }: LoaderFunctionArgs) {
  // we don't use the client here -- if they have this permission, we'll upgrade to a service role if needed
  const { companyId, userId } = await requirePermissions(request, {
    create: "invoicing",
  });

  const url = new URL(request.url);
  const sourceDocument = url.searchParams.get("sourceDocument") ?? undefined;
  const sourceDocumentId = url.searchParams.get("sourceDocumentId") ?? "";

  let result: FunctionsResponse<{ id: string }>;

  switch (sourceDocument) {
    case "Purchase Order":
      if (!sourceDocumentId) throw new Error("Missing sourceDocumentId");
      result = await createPurchaseInvoiceFromPurchaseOrder(
        sourceDocumentId,
        companyId,
        userId
      );

      if (result.error || !result?.data) {
        throw redirect(
          request.headers.get("Referer") ?? path.to.purchaseOrders,
          await flash(
            request,
            error(result.error, "Failed to create purchase invoice")
          )
        );
      }

      throw redirect(path.to.purchaseInvoice(result.data?.id!));

    default:
      return null;
  }
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "invoicing",
  });

  const formData = await request.formData();
  const validation = await validator(purchaseInvoiceValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const nextSequence = await getNextSequence(
    client,
    "purchaseInvoice",
    companyId
  );
  if (nextSequence.error) {
    throw redirect(
      path.to.newPurchaseInvoice,
      await flash(
        request,
        error(nextSequence.error, "Failed to get next sequence")
      )
    );
  }

  const { id, ...data } = validation.data;

  const createPurchaseInvoice = await upsertPurchaseInvoice(client, {
    ...data,
    invoiceId: nextSequence.data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createPurchaseInvoice.error || !createPurchaseInvoice.data?.[0]) {
    await rollbackNextSequence(client, "purchaseInvoice", companyId);
    throw redirect(
      path.to.purchaseInvoices,
      await flash(
        request,
        error(createPurchaseInvoice.error, "Failed to insert purchase invoice")
      )
    );
  }

  const invoice = createPurchaseInvoice.data?.[0];

  throw redirect(path.to.purchaseInvoice(invoice?.id!));
}

export default function PurchaseInvoiceNewRoute() {
  const [params] = useUrlParams();
  const supplierId = params.get("supplierId");

  const initialValues = {
    id: undefined,
    invoiceId: undefined,
    supplierId: supplierId ?? "",
    status: "Draft" as PurchaseInvoiceStatus,
  };

  return (
    <div className="w-1/2 max-w-[600px] min-w-[420px] mx-auto mt-8">
      <PurchaseInvoiceForm initialValues={initialValues} />
    </div>
  );
}
