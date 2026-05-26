import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { customerTaxValidator } from "~/modules/sales";
import {
  getCustomerTax,
  updateCustomerTax
} from "~/modules/sales/sales.service.server";
import { CustomerTaxForm } from "~/modules/sales/ui/Customer";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales"
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const customerTax = await getCustomerTax(customerId);

  if (customerTax.error || !customerTax.data) {
    throw redirect(
      path.to.customer(customerId),
      await flash(
        request,
        error(customerTax.error, "Failed to load customer tax information")
      )
    );
  }

  return {
    customerTax: customerTax.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const formData = await request.formData();
  const validation = await validator(customerTaxValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const taxExemptionCertificatePath =
    formData.get("taxExemptionCertificatePath")?.toString() || null;

  const update = await updateCustomerTax({
    ...validation.data,
    customerId,
    taxExemptionCertificatePath,
    updatedBy: userId
  });
  if (update.error) {
    throw redirect(
      path.to.customer(customerId),
      await flash(
        request,
        error(update.error, "Failed to update customer tax information")
      )
    );
  }

  throw redirect(
    path.to.customerTax(customerId),
    await flash(request, success("Updated customer tax information"))
  );
}

export default function CustomerTaxRoute() {
  const { customerTax } = useLoaderData<typeof loader>();
  const initialValues = {
    customerId: customerTax?.customerId ?? "",
    taxId: customerTax?.taxId ?? "",
    vatNumber: customerTax?.vatNumber ?? "",
    eori: customerTax?.eori ?? "",
    taxExempt: customerTax?.taxExempt ?? false,
    taxExemptionReason: customerTax?.taxExemptionReason ?? undefined,
    taxExemptionCertificateNumber:
      customerTax?.taxExemptionCertificateNumber ?? "",
    taxExemptionCertificatePath:
      customerTax?.taxExemptionCertificatePath ?? null
  };

  return <CustomerTaxForm initialValues={initialValues} />;
}
