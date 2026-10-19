// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { rejectCrossSiteNavigation } from "@carbon/auth/middleware/security.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { getErrorMessage, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { NewRecordPage } from "~/components/NewRecordPage";
import { useCompanyToday, useUrlParams, useUser } from "~/hooks";
import { purchaseInvoiceValidator } from "~/modules/invoicing/invoicing.models";
import { createPurchaseInvoiceFromPurchaseOrder } from "~/modules/invoicing/invoicing.service";
import { PurchaseInvoiceForm } from "~/modules/invoicing/ui";
import { getDatabaseClient } from "~/services/database.server";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path, requestReferrer } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Purchasing`,
  to: path.to.purchasing,
  module: "purchasing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  // Writes on GET: a link on another site must not trigger it.
  rejectCrossSiteNavigation(request);
  // we don't use the client here -- if they have this permission, we'll upgrade to a service role if needed
  const { companyId, userId } = await requirePermissions(request, {
    create: "invoicing"
  });

  const url = new URL(request.url);
  const sourceDocument = url.searchParams.get("sourceDocument") ?? undefined;
  const sourceDocumentId = url.searchParams.get("sourceDocumentId") ?? "";

  let result: Awaited<
    ReturnType<typeof createPurchaseInvoiceFromPurchaseOrder>
  >;

  switch (sourceDocument) {
    case "Purchase Order":
      if (!sourceDocumentId) throw new Error("Missing sourceDocumentId");
      result = await createPurchaseInvoiceFromPurchaseOrder(
        getCarbonServiceRole(),
        getDatabaseClient(),
        sourceDocumentId,
        companyId,
        userId
      );

      if (result.error || !result?.data) {
        throw redirect(
          requestReferrer(request) ?? path.to.purchaseOrders,
          await flash(
            request,
            error(
              result.error,
              getErrorMessage(result.error, "Failed to create purchase invoice")
            )
          )
        );
      }

      throw redirect(path.to.purchaseInvoice(result.data?.id!));

    default:
      return null;
  }
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(purchaseInvoiceValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const formData = input.formData ?? new FormData();
  const api = await carbon(args.request);
  const result = await api.invoicing.createPurchaseInvoice({
    ...input.data,
    customFields: setCustomFields(formData),
    lines: extractedLines(formData.get("extractedLineItems")),
    taxAmount:
      Number.parseFloat(String(formData.get("extractedTaxAmount") ?? "")) || 0,
    documentPath:
      (formData.get("extractedStoragePath") as string | null) || undefined
  });
  if (!result.data) {
    return respond(args.request, result).redirect(path.to.invoicingPurchasing);
  }
  throw redirect(path.to.purchaseInvoice(result.data.id));
}

/** The lines an extraction found, posted as JSON; unreadable means none. */
function extractedLines(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function PurchaseInvoiceNewRoute() {
  const [params] = useUrlParams();
  const supplierId = params.get("supplierId");
  const { defaults } = useUser();

  const companyToday = useCompanyToday();
  const initialValues = {
    id: undefined,
    invoiceId: undefined,
    supplierId: supplierId ?? "",
    locationId: defaults?.locationId ?? "",
    dateIssued: companyToday
  };

  return (
    <NewRecordPage>
      <PurchaseInvoiceForm initialValues={initialValues} />
    </NewRecordPage>
  );
}
