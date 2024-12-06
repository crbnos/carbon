import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getSupplierShipping,
  supplierShippingValidator,
  updateSupplierShipping,
} from "~/modules/purchasing";
import SupplierShippingForm from "~/modules/purchasing/ui/Supplier/SupplierShippingForm";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing",
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const supplierShipping = await getSupplierShipping(client, supplierId);

  if (supplierShipping.error || !supplierShipping.data) {
    throw redirect(
      path.to.supplier(supplierId),
      await flash(
        request,
        error(supplierShipping.error, "Failed to load supplier shipping")
      )
    );
  }

  return json({
    supplierShipping: supplierShipping.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "purchasing",
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const formData = await request.formData();
  const validation = await validator(supplierShippingValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await updateSupplierShipping(client, {
    ...validation.data,
    supplierId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (update.error) {
    throw redirect(
      path.to.supplier(supplierId),
      await flash(
        request,
        error(update.error, "Failed to update supplier shipping")
      )
    );
  }

  throw redirect(
    path.to.supplierShipping(supplierId),
    await flash(request, success("Updated supplier shipping"))
  );
}

export default function SupplierShippingRoute() {
  const { supplierShipping } = useLoaderData<typeof loader>();
  const initialValues = {
    supplierId: supplierShipping?.supplierId ?? "",
    shippingSupplierId: supplierShipping?.shippingSupplierId ?? "",
    shippingSupplierContactId:
      supplierShipping?.shippingSupplierContactId ?? "",
    shippingSupplierLocationId:
      supplierShipping?.shippingSupplierLocationId ?? "",
    shippingMethodId: supplierShipping?.shippingMethodId ?? "",
    shippingTermId: supplierShipping?.shippingTermId ?? "",
    ...getCustomFields(supplierShipping?.customFields),
  };

  return (
    <SupplierShippingForm
      key={initialValues.supplierId}
      initialValues={initialValues}
    />
  );
}
