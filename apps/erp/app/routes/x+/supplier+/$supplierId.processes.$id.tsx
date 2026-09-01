import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs
} from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { SupplierProcess } from "~/modules/purchasing";
import {
  supplierProcessValidator,
  upsertSupplierProcess
} from "~/modules/purchasing";
import SupplierProcessForm from "~/modules/purchasing/ui/Supplier/SupplierProcessForm";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { supplierProcessesQuery } from "~/utils/react-query";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "purchasing"
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

  const { id, ...d } = validation.data;
  if (!id) throw new Error("Could not find id");

  const createSupplierProcess = await upsertSupplierProcess(client, {
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
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

export async function clientAction({
  request,
  serverAction
}: ClientActionFunctionArgs) {
  const formData = await request.clone().formData(); // if we. don't clone it we can't access it in the action
  const validation = await validator(supplierProcessValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { processId } = validation.data;
  try {
    return await serverAction();
  } finally {
    // Invalidate AFTER the update commits so the reactive useSupplierProcesses
    // observer refetches the updated supplier without a page refresh.
    if (processId) {
      window.clientCache?.invalidateQueries({
        queryKey: supplierProcessesQuery(processId).queryKey
      });
    }
  }
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

  const navigate = useNavigate();

  const initialValues = {
    id: process.id ?? undefined,
    supplierId: process.supplierId ?? "",
    processId: process.processId ?? "",
    minimumCost: process.minimumCost ?? 0,
    leadTime: process.leadTime ?? 0
  };

  return (
    <SupplierProcessForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
