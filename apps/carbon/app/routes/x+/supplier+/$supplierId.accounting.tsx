import { validationError, validator } from "@carbon/form";
import { useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import type { SupplierDetail } from "~/modules/purchasing";
import {
  supplierAccountingValidator,
  updateSupplierAccounting,
} from "~/modules/purchasing";
import SupplierAccountingForm from "~/modules/purchasing/ui/Supplier/SupplierAccountingForm";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "purchasing",
  });
  const formData = await request.formData();
  const validation = await validator(supplierAccountingValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  if (!id) {
    throw redirect(
      path.to.supplierAccounting(id),
      await flash(request, error(null, "Failed to update supplier accounting"))
    );
  }

  const update = await updateSupplierAccounting(client, {
    id,
    ...data,
    updatedBy: userId,
  });

  if (update.error) {
    throw redirect(
      path.to.supplierAccounting(id),
      await flash(
        request,
        error(update.error, "Failed to update supplier accounting")
      )
    );
  }

  return json(
    null,
    await flash(request, success("Updated supplier accounting"))
  );
}

export default function SupplierAccountingRoute() {
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("Could not find supplierId");
  const routeData = useRouteData<{ supplier: SupplierDetail }>(
    path.to.supplier(supplierId)
  );

  if (!routeData?.supplier) return null;

  const initialValues = {
    id: routeData?.supplier?.id ?? undefined,
    supplierTypeId: routeData?.supplier?.supplierTypeId ?? undefined,
    taxId: routeData?.supplier?.taxId ?? "",
  };

  return (
    <SupplierAccountingForm
      key={initialValues.id}
      initialValues={initialValues}
    />
  );
}
