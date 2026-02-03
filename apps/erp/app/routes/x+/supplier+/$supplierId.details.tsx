import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { SupplierDetail } from "~/modules/purchasing";
import { supplierValidator, upsertSupplier } from "~/modules/purchasing";
import SupplierForm from "~/modules/purchasing/ui/Supplier/SupplierForm";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const formData = await request.formData();
  const validation = await validator(supplierValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;

  if (!id) {
    throw redirect(
      path.to.suppliers,
      await flash(request, error(null, "Failed to update supplier"))
    );
  }

  const update = await upsertSupplier(client, {
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (update.error) {
    throw redirect(
      path.to.suppliers,
      await flash(request, error(update.error, "Failed to update supplier"))
    );
  }

  return data(null, await flash(request, success("Updated supplier")));
}

export default function SupplierEditRoute() {
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("Could not find supplierId");
  const routeData = useRouteData<{ supplier: SupplierDetail }>(
    path.to.supplier(supplierId)
  );

  if (!routeData?.supplier) return null;

  const initialValues = {
    id: routeData?.supplier?.id ?? undefined,
    name: routeData?.supplier?.name ?? "",
    supplierTypeId: routeData?.supplier?.supplierTypeId ?? undefined,
    supplierStatusId: routeData?.supplier?.supplierStatusId ?? undefined,
    accountManagerId: routeData?.supplier?.accountManagerId ?? undefined,
    taxId: routeData?.supplier?.taxId ?? "",
    currencyCode: routeData?.supplier?.currencyCode ?? undefined,
    website: routeData?.supplier?.website ?? "",
    purchasingContactId: routeData?.supplier?.purchasingContactId ?? undefined,
    invoicingContactId: routeData?.supplier?.invoicingContactId ?? undefined,
    defaultCc: routeData?.supplier?.defaultCc ?? [],
    ...getCustomFields(routeData?.supplier?.customFields)
  };

  return <SupplierForm key={initialValues.id} initialValues={initialValues} />;
}
