import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ClientActionFunctionArgs} from "@remix-run/react";
import {
  useNavigate,
  useParams,
} from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  supplierProcessValidator,
  upsertSupplierProcess,
} from "~/modules/purchasing";
import SupplierProcessForm from "~/modules/purchasing/ui/Supplier/SupplierProcessForm";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { supplierProcessesQuery } from "~/utils/react-query";

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

export async function clientAction({
  request,
  serverAction,
  params,
}: ClientActionFunctionArgs) {
  const formData = await request.clone().formData(); // if we. don't clone it we can't access it in the action
  const validation = await validator(supplierProcessValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  if (validation.data.processId) {
    window.clientCache?.setQueryData(
      supplierProcessesQuery(validation.data.processId).queryKey,
      null
    );
  }
  return await serverAction();
}

export default function NewSupplierProcessRoute() {
  const { supplierId } = useParams();
  const navigate = useNavigate();

  if (!supplierId) throw new Error("Could not find supplier id");

  const initialValues = {
    supplierId: supplierId,
    processId: "",
    minimumCost: 0,
    leadTime: 0,
  };

  return (
    <SupplierProcessForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
