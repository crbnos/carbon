import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useNavigate } from "react-router";
import type { PaymentTermCalculationMethod } from "~/modules/accounting";
import { paymentTermValidator } from "~/modules/accounting";
import { upsertPaymentTerm } from "~/modules/accounting/accounting.service.server";
import { PaymentTermForm } from "~/modules/accounting/ui/PaymentTerms";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { getCompanyId, paymentTermsQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "accounting"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(paymentTermValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...rest } = validation.data;

  const insertPaymentTerm = await upsertPaymentTerm({
    ...rest,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertPaymentTerm.error) {
    return data(
      {},
      await flash(
        request,
        error(insertPaymentTerm.error, "Failed to insert payment term")
      )
    );
  }

  return modal
    ? data(insertPaymentTerm, { status: 201 })
    : redirect(
        `${path.to.paymentTerms}?${getParams(request)}`,
        await flash(request, success("Payment term created"))
      );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    paymentTermsQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function NewPaymentTermsRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    daysDue: 0,
    daysDiscount: 0,
    discountPercentage: 0,
    calculationMethod: "Net" as PaymentTermCalculationMethod
  };

  return (
    <PaymentTermForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
