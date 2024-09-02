import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import type { PaymentTermCalculationMethod } from "~/modules/accounting";
import {
  PaymentTermForm,
  getPaymentTerm,
  paymentTermValidator,
  upsertPaymentTerm,
} from "~/modules/accounting";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost, notFound } from "~/utils/http";
import { getParams, path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
    role: "employee",
  });

  const { paymentTermId } = params;
  if (!paymentTermId) throw notFound("paymentTermId not found");

  const paymentTerm = await getPaymentTerm(client, paymentTermId);

  return json({
    paymentTerm: paymentTerm?.data ?? null,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting",
  });

  const formData = await request.formData();
  const validation = await validator(paymentTermValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("id not found");

  const updatePaymentTerm = await upsertPaymentTerm(client, {
    id,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updatePaymentTerm.error) {
    return json(
      {},
      await flash(
        request,
        error(updatePaymentTerm.error, "Failed to update payment term")
      )
    );
  }

  throw redirect(
    `${path.to.paymentTerms}?${getParams(request)}`,
    await flash(request, success("Updated payment term"))
  );
}

export default function EditPaymentTermsRoute() {
  const { paymentTerm } = useLoaderData<typeof loader>();

  const initialValues = {
    id: paymentTerm?.id ?? undefined,
    name: paymentTerm?.name ?? "",
    daysDue: paymentTerm?.daysDue ?? 0,
    daysDiscount: paymentTerm?.daysDiscount ?? 0,
    discountPercentage: paymentTerm?.discountPercentage ?? 0,
    calculationMethod:
      paymentTerm?.calculationMethod ?? ("Net" as PaymentTermCalculationMethod),
    ...getCustomFields(paymentTerm?.customFields),
  };

  return (
    <PaymentTermForm key={initialValues.id} initialValues={initialValues} />
  );
}
