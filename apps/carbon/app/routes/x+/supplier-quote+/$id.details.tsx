import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { Spinner, type JSONContent } from "@carbon/react";
import { Await, useParams } from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { Suspense } from "react";
import { useRouteData } from "~/hooks";
import { supplierQuoteValidator } from "~/modules/purchasing/purchasing.models";
import { upsertSupplierQuote } from "~/modules/purchasing/purchasing.service";
import type {
  SupplierInteraction,
  SupplierQuote,
} from "~/modules/purchasing/types";
import {
  SupplierInteractionDocuments,
  SupplierInteractionNotes,
} from "~/modules/purchasing/ui/SupplierInteraction";
import SupplierQuoteSummary from "~/modules/purchasing/ui/SupplierQuote/SupplierQuoteSummary";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs",
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "purchasing",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(supplierQuoteValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { supplierQuoteId, ...data } = validation.data;
  if (!supplierQuoteId) throw new Error("Could not find supplierQuoteId");

  const update = await upsertSupplierQuote(client, {
    id,
    supplierQuoteId,
    ...data,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });
  if (update.error) {
    throw redirect(
      path.to.supplierQuote(id),
      await flash(request, error(update.error, "Failed to update quote"))
    );
  }

  throw redirect(
    path.to.supplierQuote(id),
    await flash(request, success("Updated quote"))
  );
}

export default function SupplierQuoteDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<{
    quote: SupplierQuote;
    files: Promise<(FileObject & { quoteLineId: string | null })[]>;
    interaction: SupplierInteraction;
  }>(path.to.supplierQuote(id));

  if (!routeData) throw new Error("Could not find quote data");
  const initialValues = {
    id: routeData?.quote?.id ?? "",
    supplierId: routeData?.quote?.supplierId ?? "",
    supplierLocationId: routeData?.quote?.supplierLocationId ?? "",
    supplierContactId: routeData?.quote?.supplierContactId ?? "",
    supplierReference: routeData?.quote?.supplierReference ?? "",
    quotedDate: routeData?.quote?.quotedDate ?? "",
    expirationDate: routeData?.quote?.expirationDate ?? "",
    supplierQuoteId: routeData?.quote?.supplierQuoteId ?? "",
    status: routeData?.quote?.status ?? "Active",
    currencyCode: routeData?.quote?.currencyCode ?? undefined,
    exchangeRate: routeData?.quote?.exchangeRate ?? undefined,
    exchangeRateUpdatedAt: routeData?.quote?.exchangeRateUpdatedAt ?? "",
  };

  return (
    <>
      <SupplierQuoteSummary />
      <SupplierInteractionNotes
        key={`notes-${initialValues.id}`}
        id={routeData.quote.id}
        title="Notes"
        table="supplierQuote"
        internalNotes={routeData.quote.internalNotes as JSONContent}
        externalNotes={routeData.quote.externalNotes as JSONContent}
      />
      <Suspense
        key={`documents-${id}`}
        fallback={
          <div className="flex w-full min-h-[480px] h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
            <Spinner className="h-10 w-10" />
          </div>
        }
      >
        <Await resolve={routeData.files}>
          {(resolvedFiles) => (
            <SupplierInteractionDocuments
              interaction={routeData.interaction}
              attachments={resolvedFiles}
              id={id}
              type="Supplier Quote"
            />
          )}
        </Await>
      </Suspense>
    </>
  );
}
