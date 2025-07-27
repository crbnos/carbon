import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { useUser } from "~/hooks";
import {
  upsertWarehouseTransfer,
  warehouseTransferValidator,
} from "~/modules/inventory";
import { WarehouseTransferForm } from "~/modules/inventory/ui/WarehouseTransfers";
import { getNextSequence } from "~/modules/settings";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "New Transfer",
  to: path.to.warehouseTransfers,
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "inventory",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory",
  });

  const formData = await request.formData();
  const validation = await validator(warehouseTransferValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  let transferId = validation.data.transferId;
  const useNextSequence = !transferId;

  if (useNextSequence) {
    const nextSequence = await getNextSequence(
      client,
      "warehouseTransfer",
      companyId
    );
    if (nextSequence.error) {
      throw redirect(
        path.to.newWarehouseTransfer,
        await flash(
          request,
          error(nextSequence.error, "Failed to get next sequence")
        )
      );
    }
    transferId = nextSequence.data;
  }

  if (!transferId) throw new Error("transferId is not defined");
  const { id, ...data } = validation.data;

  const createTransfer = await upsertWarehouseTransfer(client, {
    ...data,
    transferId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
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
    reference: "",
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <WarehouseTransferForm initialValues={initialValues} />
    </div>
  );
}
