import { validationError, validator } from "@carbon/form";
import { useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import type { SupplierDetail } from "~/modules/purchasing";
import {
  SupplierForm,
  supplierValidator,
  upsertSupplier,
} from "~/modules/purchasing";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "purchasing",
  });

  const formData = await request.formData();
  const validation = await validator(supplierValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  if (!id) {
    throw redirect(
      path.to.suppliers,
      await flash(request, error(null, "Failed to update supplier"))
    );
  }

  const update = await upsertSupplier(client, {
    id,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (update.error) {
    throw redirect(
      path.to.suppliers,
      await flash(request, error(update.error, "Failed to update supplier"))
    );
  }

  return json(null, await flash(request, success("Updated supplier")));
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
    ...getCustomFields(routeData?.supplier?.customFields),
  };

  return <SupplierForm key={initialValues.id} initialValues={initialValues} />;
}
