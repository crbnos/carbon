import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import type { PaymentTermCalculationMethod } from "~/modules/accounting";
import { paymentTermValidator } from "~/modules/accounting";
import {
  getPaymentTerm,
  upsertPaymentTerm
} from "~/modules/accounting/accounting.service.server";
import { PaymentTermForm } from "~/modules/accounting/ui/PaymentTerms";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { getCompanyId, paymentTermsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { paymentTermId } = params;
  if (!paymentTermId) throw notFound("paymentTermId not found");

  const paymentTerm = await getPaymentTerm(paymentTermId);

  return {
    paymentTerm: paymentTerm?.data ?? null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(paymentTermValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updatePaymentTerm = await upsertPaymentTerm({
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updatePaymentTerm.error) {
    return data(
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

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    paymentTermsQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function EditPaymentTermsRoute() {
  const { paymentTerm } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: paymentTerm?.id ?? undefined,
    name: paymentTerm?.name ?? "",
    daysDue: paymentTerm?.daysDue ?? 0,
    daysDiscount: paymentTerm?.daysDiscount ?? 0,
    discountPercentage: paymentTerm?.discountPercentage ?? 0,
    calculationMethod:
      paymentTerm?.calculationMethod ?? ("Net" as PaymentTermCalculationMethod),
    ...getCustomFields(paymentTerm?.customFields)
  };

  return (
    <PaymentTermForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
