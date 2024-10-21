import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import type { PaymentTermCalculationMethod } from "~/modules/accounting";
import {
  PaymentTermForm,
  paymentTermValidator,
  upsertPaymentTerm,
} from "~/modules/accounting";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "accounting",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting",
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(paymentTermValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertPaymentTerm = await upsertPaymentTerm(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertPaymentTerm.error) {
    return json(
      {},
      await flash(
        request,
        error(insertPaymentTerm.error, "Failed to insert payment term")
      )
    );
  }

  return modal
    ? json(insertPaymentTerm, { status: 201 })
    : redirect(
        `${path.to.paymentTerms}?${getParams(request)}`,
        await flash(request, success("Payment term created"))
      );
}

export default function NewPaymentTermsRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    daysDue: 0,
    daysDiscount: 0,
    discountPercentage: 0,
    calculationMethod: "Net" as PaymentTermCalculationMethod,
  };

  return (
    <PaymentTermForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
