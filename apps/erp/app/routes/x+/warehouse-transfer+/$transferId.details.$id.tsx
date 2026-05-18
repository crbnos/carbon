import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useLoaderData,
  useNavigate,
  useParams
} from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  deleteWarehouseTransferLine,
  getWarehouseTransfer,
  getWarehouseTransferLine,
  isWarehouseTransferLocked,
  upsertWarehouseTransferLine,
  WarehouseTransferLineForm
} from "~/modules/inventory";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

const warehouseTransferLineActionValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create"),
    transferId: z.string().min(1),
    itemId: z.string().min(1),
    quantity: zfd.numeric(z.number().min(0.0001)),
    fromStorageUnitId: zfd.text(z.string().optional()),
    toStorageUnitId: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional())
  }),
  z.object({
    type: z.literal("update"),
    id: z.string().min(1),
    quantity: zfd.numeric(z.number().min(0.0001)),
    fromStorageUnitId: zfd.text(z.string().optional()),
    toStorageUnitId: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional())
  }),
  z.object({
    type: z.literal("delete"),
    id: z.string().min(1)
  })
]);

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    update: "inventory"
  });

  const { transferId, id } = params;
  if (!transferId) throw new Error("transferId not found");
  if (!id) throw new Error("id not found");

  const warehouseTransferLine = await getWarehouseTransferLine(transferId, id);
  if (warehouseTransferLine.error) {
    throw redirect(
      path.to.warehouseTransferDetails(transferId),
      await flash(
        request,
        error(
          warehouseTransferLine.error,
          "Failed to load warehouse transfer line"
        )
      )
    );
  }

  return { warehouseTransferLine: warehouseTransferLine.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { transferId, id } = params;
  if (!transferId) throw new Error("transferId not found");
  if (!id) throw new Error("id not found");

  const { client: viewClient } = await requirePermissions(request, {
    view: "inventory"
  });
  const transfer = await getWarehouseTransfer(viewClient, transferId);
  await requireUnlocked({
    request,
    isLocked: isWarehouseTransferLocked(transfer.data?.status),
    redirectTo: path.to.warehouseTransfer(transferId),
    message: "Cannot modify a locked warehouse transfer. Reopen it first."
  });

  const formData = await request.formData();
  const validation = await validator(
    warehouseTransferLineActionValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { type, ...d } = validation.data;

  switch (type) {
    case "update": {
      const result = await upsertWarehouseTransferLine({
        id,
        ...d,
        transferId,
        companyId,
        updatedBy: userId
      });

      if (result.error) {
        return data(
          { error: result.error },
          await flash(
            request,
            error(result.error, "Failed to update warehouse transfer line")
          )
        );
      }

      throw redirect(
        path.to.warehouseTransferDetails(transferId),
        await flash(request, success("Updated warehouse transfer line"))
      );
    }

    case "delete": {
      const result = await deleteWarehouseTransferLine(id);

      if (result.error) {
        return data(
          { error: result.error },
          await flash(
            request,
            error(result.error, "Failed to delete warehouse transfer line")
          )
        );
      }

      throw redirect(
        path.to.warehouseTransferDetails(transferId),
        await flash(request, success("Deleted warehouse transfer line"))
      );
    }

    default:
      throw redirect(
        path.to.warehouseTransferDetails(transferId),
        await flash(
          request,
          error("Invalid action type", "Invalid action type")
        )
      );
  }
}

export default function WarehouseTransferLineDetailsRoute() {
  const params = useParams();
  const { transferId, id } = params;
  if (!transferId) throw new Error("transferId not found");
  if (!id) throw new Error("id not found");

  const { warehouseTransferLine } = useLoaderData<typeof loader>();
  const initialValues = {
    type: "update" as const,
    id,
    transferId,
    itemId: warehouseTransferLine.itemId ?? "",
    fromLocationId:
      warehouseTransferLine.warehouseTransfer?.fromLocationId ?? "",
    toLocationId: warehouseTransferLine.warehouseTransfer?.toLocationId ?? "",
    quantity: warehouseTransferLine.quantity ?? 1,
    fromStorageUnitId: warehouseTransferLine.fromStorageUnitId ?? "",
    toStorageUnitId: warehouseTransferLine.toStorageUnitId ?? "",
    notes: warehouseTransferLine.notes ?? ""
  };

  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-2 pb-16 w-full">
      <WarehouseTransferLineForm
        key={initialValues.id}
        initialValues={initialValues}
        warehouseTransfer={warehouseTransferLine.warehouseTransfer!}
        onClose={() => navigate(-1)}
      />
    </div>
  );
}
