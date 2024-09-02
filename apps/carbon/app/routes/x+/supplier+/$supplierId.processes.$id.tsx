import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { SupplierProcess } from "~/modules/purchasing";
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
  const { client, userId } = await requirePermissions(request, {
    create: "purchasing",
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const formData = await request.formData();

  const validation = await validator(supplierProcessValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("Could not find id");

  const createSupplierProcess = await upsertSupplierProcess(client, {
    id,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createSupplierProcess.error) {
    throw redirect(
      path.to.supplierProcesses(supplierId),
      await flash(
        request,
        error(createSupplierProcess.error, "Failed to update supplier process")
      )
    );
  }

  return redirect(path.to.supplierProcesses(supplierId));
}

export default function SupplierProcessRoute() {
  const { supplierId, id } = useParams();
  if (!supplierId) throw new Error("Could not find supplier id");
  if (!id) throw new Error("Could not find id");
  const routeData = useRouteData<{ processes: SupplierProcess[] }>(
    path.to.supplierProcesses(supplierId)
  );

  const process = routeData?.processes.find((process) => process.id === id);
  if (!process) throw new Error("Could not find process");

  const initialValues = {
    id: process.id ?? undefined,
    supplierId: process.supplierId ?? "",
    processId: process.processId ?? "",
    minimumCost: process.minimumCost ?? 0,
    unitCost: process.unitCost ?? 0,
    leadTime: process.leadTime ?? 0,
  };

  return <SupplierProcessForm initialValues={initialValues} />;
}
