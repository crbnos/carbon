import { Outlet, json, redirect, useLoaderData } from "@remix-run/react";
import QuotationAssemblyForm from "~/modules/sales/ui/Quotation/QuotationAssemblyForm";

import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  getQuoteAssembly,
  quotationAssemblyValidator,
  upsertQuoteAssembly,
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

  const { id, assemblyId } = params;
  if (!id) throw new Error("Could not find id");
  if (!assemblyId) throw new Error("Could not find assemblyId");

  const assembly = await getQuoteAssembly(client, assemblyId);
  if (assembly.error) {
    throw redirect(
      path.to.quote(id),
      await flash(
        request,
        error(assembly.error, "Failed to load quote assembly.")
      )
    );
  }

  return json({
    quoteAssembly: assembly.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const { id: quoteId, lineId: quoteLineId, assemblyId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!quoteLineId) throw new Error("Could not find quoteLineId");
  if (!assemblyId) throw new Error("Could not find assemblyId");

  const formData = await request.formData();
  const validation = await validator(quotationAssemblyValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const updateQuotationAssembly = await upsertQuoteAssembly(client, {
    id: assemblyId,
    quoteId,
    quoteLineId,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateQuotationAssembly.error) {
    return json(
      path.to.quote(quoteId),
      await flash(
        request,
        error(updateQuotationAssembly.error, "Failed to update quote assembly")
      )
    );
  }

  throw redirect(path.to.quoteAssembly(quoteId, quoteLineId, assemblyId));
}

export default function QuoteAssembly() {
  const { quoteAssembly } = useLoaderData<typeof loader>();

  const initialValues = {
    id: quoteAssembly.id,
    quoteId: quoteAssembly.quoteId,
    quoteLineId: quoteAssembly.quoteLineId,
    parentAssemblyId: quoteAssembly.parentAssemblyId ?? undefined,
    itemId: quoteAssembly.itemId,
    description: quoteAssembly.description ?? "",
    quantityPerParent: quoteAssembly.quantityPerParent,
    unitOfMeasureCode: quoteAssembly.unitOfMeasureCode ?? "",
    ...getCustomFields(quoteAssembly.customFields),
  };

  return (
    <>
      <QuotationAssemblyForm
        key={initialValues.id}
        initialValues={initialValues}
      />
      <Outlet />
    </>
  );
}
