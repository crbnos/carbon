import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useParams } from "@remix-run/react";
import {
  SupplierProcessForm,
  supplierProcessValidator,
  upsertSupplierProcess,
} from "~/modules/purchasing";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing",
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(supplierProcessValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const createSupplierProcess = await upsertSupplierProcess(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createSupplierProcess.error) {
    throw redirect(
      path.to.supplierProcesses(supplierId),
      await flash(
        request,
        error(createSupplierProcess.error, "Failed to create supplier process")
      )
    );
  }

  return modal
    ? json(createSupplierProcess)
    : redirect(path.to.supplierProcesses(supplierId));
}

export default function NewSupplierProcessRoute() {
  const { supplierId } = useParams();

  if (!supplierId) throw new Error("Could not find supplier id");

  const initialValues = {
    supplierId: supplierId,
    processId: "",
    minimumCost: 0,
    unitCost: 0,
    leadTime: 0,
  };

  return <SupplierProcessForm initialValues={initialValues} />;
}
