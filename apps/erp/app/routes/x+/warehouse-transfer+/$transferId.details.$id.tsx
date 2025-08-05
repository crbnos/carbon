import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  deleteWarehouseTransferLine,
  getWarehouseTransferLine,
  upsertWarehouseTransferLine,
  WarehouseTransferLineForm,
} from "~/modules/inventory";
import { path } from "~/utils/path";

const warehouseTransferLineActionValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create"),
    transferId: z.string().min(1),
    itemId: z.string().min(1),
    quantity: zfd.numeric(z.number().min(0.0001)),
    fromShelfId: zfd.text(z.string().optional()),
    toShelfId: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional()),
  }),
  z.object({
    type: z.literal("update"),
    id: z.string().min(1),
    quantity: zfd.numeric(z.number().min(0.0001)),
    fromShelfId: zfd.text(z.string().optional()),
    toShelfId: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional()),
  }),
  z.object({
    type: z.literal("delete"),
    id: z.string().min(1),
  }),
]);

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    update: "inventory",
  });

  const { transferId, id } = params;
  if (!transferId) throw new Error("transferId not found");
  if (!id) throw new Error("id not found");

  const warehouseTransferLine = await getWarehouseTransferLine(
    client,
    transferId,
    id
  );
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

  return json({ warehouseTransferLine: warehouseTransferLine.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory",
  });

  const { transferId, id } = params;
  if (!transferId) throw new Error("transferId not found");
  if (!id) throw new Error("id not found");

  const formData = await request.formData();
  const validation = await validator(
    warehouseTransferLineActionValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { type, ...data } = validation.data;

  switch (type) {
    case "update": {
      const result = await upsertWarehouseTransferLine(client, {
        id,
        ...data,
        transferId,
        companyId,
        updatedBy: userId,
      });

      if (result.error) {
        return json(
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
      const result = await deleteWarehouseTransferLine(client, id);

      if (result.error) {
        return json(
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
    fromShelfId: warehouseTransferLine.fromShelfId ?? "",
    toShelfId: warehouseTransferLine.toShelfId ?? "",
    notes: warehouseTransferLine.notes ?? "",
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
