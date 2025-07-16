import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { FunctionsResponse } from "@supabase/functions-js";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { useUrlParams, useUser } from "~/hooks";
import {
  createSalesInvoiceFromSalesOrder,
  createSalesInvoiceFromShipment,
  salesInvoiceValidator,
  upsertSalesInvoice,
} from "~/modules/invoicing";
import SalesInvoiceForm from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceForm";
import { getNextSequence } from "~/modules/settings";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Sales",
  to: path.to.sales,
  module: "sales",
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
    case "Sales Order":
      if (!sourceDocumentId) throw new Error("Missing sourceDocumentId");

      result = await createSalesInvoiceFromSalesOrder(
        getCarbonServiceRole(),
        sourceDocumentId,
        companyId,
        userId
      );

      if (result.error || !result?.data) {
        throw redirect(
          request.headers.get("Referer") ?? path.to.salesOrders,
          await flash(
            request,
            error(result.error, "Failed to create sales invoice")
          )
        );
      }

      throw redirect(path.to.salesInvoice(result.data?.id!));

    case "Shipment":
      if (!sourceDocumentId) throw new Error("Missing sourceDocumentId");
      result = await createSalesInvoiceFromShipment(
        getCarbonServiceRole(),
        sourceDocumentId,
        companyId,
        userId
      );

      if (result.error || !result?.data) {
        throw redirect(
          request.headers.get("Referer") ?? path.to.shipment(sourceDocumentId),
          await flash(
            request,
            error(result.error, "Failed to create sales invoice")
          )
        );
      }

      throw redirect(path.to.salesInvoice(result.data?.id!));

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
  const validation = await validator(salesInvoiceValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  let invoiceId = data.invoiceId;
  const useNextSequence = !invoiceId;

  if (useNextSequence) {
    const nextSequence = await getNextSequence(
      client,
      "salesInvoice",
      companyId
    );
    if (nextSequence.error) {
      throw redirect(
        path.to.newSalesInvoice,
        await flash(
          request,
          error(nextSequence.error, "Failed to get next sequence")
        )
      );
    }
    invoiceId = nextSequence.data;
  }

  if (!invoiceId) throw new Error("invoiceId is not defined");

  const createSalesInvoice = await upsertSalesInvoice(client, {
    ...data,
    invoiceId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createSalesInvoice.error || !createSalesInvoice.data?.[0]) {
    console.error(createSalesInvoice.error);
    throw redirect(
      path.to.salesInvoices,
      await flash(
        request,
        error(createSalesInvoice.error, "Failed to insert sales invoice")
      )
    );
  }

  const invoice = createSalesInvoice.data?.[0];

  throw redirect(path.to.salesInvoice(invoice?.id!));
}

export default function SalesInvoiceNewRoute() {
  const [params] = useUrlParams();
  const customerId = params.get("customerId");
  const { defaults } = useUser();

  const initialValues = {
    id: undefined,
    invoiceId: undefined,
    customerId: customerId ?? "",
    locationId: defaults?.locationId ?? "",
    dateIssued: today(getLocalTimeZone()).toString(),
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <SalesInvoiceForm initialValues={initialValues} />
    </div>
  );
}
