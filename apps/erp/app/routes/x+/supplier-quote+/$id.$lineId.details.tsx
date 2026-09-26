import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import { useRouteData } from "@carbon/react";
import { Fragment } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useParams } from "react-router";
import { DeferredFiles } from "~/components";
import type {
  SupplierQuote,
  SupplierQuoteLinePrice
} from "~/modules/purchasing";
import {
  getSupplierInteractionLineDocuments,
  getSupplierQuote,
  getSupplierQuoteLine,
  getSupplierQuoteLinePrices,
  isSupplierQuoteLocked,
  supplierQuoteLineValidator,
  upsertSupplierQuoteLine
} from "~/modules/purchasing";
import {
  SupplierInteractionLineDocuments,
  SupplierInteractionLineNotes
} from "~/modules/purchasing/ui/SupplierInteraction";
import {
  SupplierQuoteLineForm,
  SupplierQuoteLinePricing
} from "~/modules/purchasing/ui/SupplierQuote";
import type { MethodItemType } from "~/modules/shared";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "supplier-quote-line-details");

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { id, lineId } = params;
  if (!id) throw new Error("Could not find id");
  if (!lineId) throw new Error("Could not find lineId");

  const serviceRole = await getCarbonServiceRole();

  const [line, prices] = await Promise.all([
    getSupplierQuoteLine(serviceRole, lineId),
    getSupplierQuoteLinePrices(serviceRole, lineId)
  ]);

  if (line.error) {
    throw redirect(
      path.to.supplierQuote(id),
      await flash(request, error(line.error, "Failed to load line"))
    );
  }

  // The service role bypasses RLS and lineId comes from the URL: the line must
  // belong to this company and to the quote in the URL.
  if (line.data.companyId !== companyId || line.data.supplierQuoteId !== id) {
    logger.error("Supplier quote line not found for company", {
      companyId,
      supplierQuoteId: id,
      lineId
    });
    throw notFound("Supplier quote line not found");
  }

  return {
    line: line.data,
    files: getSupplierInteractionLineDocuments(serviceRole, companyId, lineId),
    pricesByQuantity: (prices?.data ?? []).reduce<
      Record<number, SupplierQuoteLinePrice>
    >((acc, price) => {
      acc[price.quantity] = price;
      return acc;
    }, {})
  };
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const { id, lineId } = params;
  if (!id) throw new Error("Could not find id");
  if (!lineId) throw new Error("Could not find lineId");

  const { client: viewClient } = await requirePermissions(request, {
    view: "purchasing"
  });
  const quote = await getSupplierQuote(viewClient, id);
  await requireUnlocked({
    request,
    isLocked: isSupplierQuoteLocked(quote.data?.status),
    redirectTo: path.to.supplierQuote(id),
    message: "Cannot modify a locked supplier quote. Reopen it first."
  });

  const formData = await request.formData();

  const validation = await validator(supplierQuoteLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...d } = validation.data;

  const updateSupplierQuoteLine = await upsertSupplierQuoteLine(client, {
    id: lineId,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateSupplierQuoteLine.error) {
    throw redirect(
      path.to.supplierQuoteLine(id, lineId),
      await flash(
        request,
        error(
          updateSupplierQuoteLine.error,
          "Failed to update supplierQuote line"
        )
      )
    );
  }

  throw redirect(path.to.supplierQuoteLine(id, lineId));
}

export default function SupplierQuoteLine() {
  const { line, files, pricesByQuantity } = useLoaderData<typeof loader>();

  const { id, lineId } = useParams();
  if (!id) throw new Error("Could not find id");
  if (!lineId) throw new Error("Could not find lineId");

  const routeData = useRouteData<{
    quote: SupplierQuote;
  }>(path.to.supplierQuote(id));

  const exchangeRate = routeData?.quote?.exchangeRate ?? 1;

  const initialValues = {
    ...line,
    id: line.id ?? undefined,
    supplierQuoteId: line.supplierQuoteId ?? "",
    supplierQuoteLineType: (line.supplierQuoteLineType ?? "Part") as
      | "Consumable"
      | "G/L Account"
      | "Material"
      | "Part"
      | "Tool",
    supplierPartId: line.supplierPartId ?? "",
    supplierPartRevision: line.supplierPartRevision ?? "",
    description: line.description ?? "",
    itemId: line.itemId ?? "",
    accountId: line.accountId ?? undefined,
    costCenterId: line.costCenterId ?? undefined,
    requiredDate: line.requiredDate ?? undefined,
    quantity: line.quantity ?? [1],
    inventoryUnitOfMeasureCode: line.inventoryUnitOfMeasureCode ?? "",
    purchaseUnitOfMeasureCode: line.purchaseUnitOfMeasureCode ?? "",
    conversionFactor: line.conversionFactor ?? undefined,
    itemType: (line.itemType ?? "Part") as MethodItemType
  };

  return (
    <Fragment key={lineId}>
      <SupplierQuoteLineForm key={lineId} initialValues={initialValues} />
      <SupplierInteractionLineNotes
        id={line.id}
        table="supplierQuoteLine"
        title="Notes"
        subTitle={line.itemReadableId ?? ""}
        internalNotes={line.internalNotes as JSONContent}
        externalNotes={line.externalNotes as JSONContent}
      />
      <SupplierQuoteLinePricing
        line={line}
        pricesByQuantity={pricesByQuantity}
        exchangeRate={exchangeRate}
      />

      <DeferredFiles resolve={files}>
        {(resolvedFiles) => (
          <SupplierInteractionLineDocuments
            files={resolvedFiles ?? []}
            id={id}
            lineId={lineId}
            type="Supplier Quote"
          />
        )}
      </DeferredFiles>

      <Outlet />
    </Fragment>
  );
}
