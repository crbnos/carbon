import { json, redirect, useLoaderData } from "@remix-run/react";

import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  QuotationMaterialLines,
  QuotationOperationForm,
  getQuoteMaterialsByOperation,
  getQuoteOperation,
  quotationOperationValidator,
  upsertQuoteOperation,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
  });

  const { id, operationId } = params;
  if (!id) throw new Error("Could not find id");
  if (!operationId) throw new Error("Could not find operationId");

  const [operation, materials] = await Promise.all([
    getQuoteOperation(client, operationId),
    getQuoteMaterialsByOperation(client, operationId),
  ]);
  if (operation.error) {
    throw redirect(
      path.to.quote(id),
      await flash(
        request,
        error(operation.error, "Failed to load quote operation.")
      )
    );
  }

  if (materials.error) {
    throw redirect(
      path.to.quote(id),
      await flash(
        request,
        error(materials.error, "Failed to load quote materials.")
      )
    );
  }

  return json({
    quoteOperation: operation.data,
    quoteMaterials: materials.data ?? [],
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const { id: quoteId, lineId: quoteLineId, operationId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!quoteLineId) throw new Error("Could not find quoteLineId");
  if (!operationId) throw new Error("Could not find operationId");

  const formData = await request.formData();
  const validation = await validator(quotationOperationValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const updateQuotationOperation = await upsertQuoteOperation(client, {
    id: operationId,
    quoteId,
    quoteLineId,
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateQuotationOperation.error) {
    return json(
      path.to.quote(quoteId),
      await flash(
        request,
        error(
          updateQuotationOperation.error,
          "Failed to update quote operation"
        )
      )
    );
  }

  throw redirect(path.to.quoteOperation(quoteId, quoteLineId, operationId));
}

export default function QuoteOperation() {
  const { quoteOperation, quoteMaterials } = useLoaderData<typeof loader>();

  const initialValues = {
    id: quoteOperation.id,
    quoteId: quoteOperation.quoteId,
    quoteLineId: quoteOperation.quoteLineId,
    quoteAssemblyId: quoteOperation.quoteAssemblyId ?? "",
    workCellTypeId: quoteOperation.workCellTypeId,
    equipmentTypeId: quoteOperation.equipmentTypeId ?? "",
    description: quoteOperation.description ?? "",
    setupHours: quoteOperation.setupHours,
    standardFactor: quoteOperation.standardFactor as "Total Hours",
    productionStandard: quoteOperation.productionStandard,
    quotingRate: quoteOperation.quotingRate,
    laborRate: quoteOperation.laborRate,
    overheadRate: quoteOperation.overheadRate,
    ...getCustomFields(quoteOperation.customFields),
  };

  return (
    <>
      <QuotationOperationForm
        key={initialValues.id}
        initialValues={initialValues}
      />
      <QuotationMaterialLines quotationMaterials={quoteMaterials} />
    </>
  );
}
