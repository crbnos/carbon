import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { useUser } from "~/hooks";
import {
  insertWarehouseTransfer,
  warehouseTransferValidator
} from "~/modules/inventory";
import { WarehouseTransferForm } from "~/modules/inventory/ui/WarehouseTransfers";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`New Transfer`,
  to: path.to.warehouseTransfers
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "inventory"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  const formData = await request.formData();
  const validation = await validator(warehouseTransferValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, transferId: providedTransferId, ...d } = validation.data;

  const createTransfer = await insertWarehouseTransfer(client, {
    ...d,
    transferId: providedTransferId || undefined,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createTransfer.error || !createTransfer.data) {
    throw redirect(
      path.to.warehouseTransfers,
      await flash(
        request,
        error(createTransfer.error, "Failed to create warehouse transfer")
      )
    );
  }

  throw redirect(path.to.warehouseTransferDetails(createTransfer.data.id));
}

export default function WarehouseTransferNewRoute() {
  const { defaults } = useUser();

  const initialValues = {
    id: undefined,
    transferId: "",
    fromLocationId: defaults?.locationId ?? "",
    toLocationId: "",
    status: "Draft" as const,
    transferDate: "",
    expectedReceiptDate: "",
    notes: "",
    reference: ""
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <WarehouseTransferForm initialValues={initialValues} />
    </div>
  );
}
