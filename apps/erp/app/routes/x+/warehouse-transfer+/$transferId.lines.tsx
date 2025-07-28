import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { HStack } from "@carbon/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { upsertWarehouseTransferLine, deleteWarehouseTransferLine } from "~/modules/inventory";
import { path } from "~/utils/path";

const warehouseTransferLineActionValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create"),
    transferId: z.string().min(1),
    itemId: z.string().min(1),
    quantity: zfd.numeric(z.number().min(0.0001)),
    fromShelfId: zfd.text(z.string().optional()),
    toShelfId: zfd.text(z.string().optional()),
    unitOfMeasureCode: zfd.text(z.string().optional()),
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

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "inventory",
  });

  const { transferId } = params;
  if (!transferId) throw new Error("transferId not found");

  const formData = await request.formData();
  const validation = await validator(warehouseTransferLineActionValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { type, ...data } = validation.data;

  switch (type) {
    case "create": {
      const result = await upsertWarehouseTransferLine(client, {
        ...data,
        transferId,
        fromLocationId: formData.get("fromLocationId") as string,
        toLocationId: formData.get("toLocationId") as string,
        createdBy: userId,
      });

      if (result.error) {
        return json(
          { error: result.error },
          await flash(
            request,
            error(result.error, "Failed to create warehouse transfer line")
          )
        );
      }

      return json(
        { success: true },
        await flash(request, success("Added warehouse transfer line"))
      );
    }

    case "update": {
      const result = await upsertWarehouseTransferLine(client, {
        ...data,
        transferId,
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

      return json(
        { success: true },
        await flash(request, success("Updated warehouse transfer line"))
      );
    }

    case "delete": {
      const result = await deleteWarehouseTransferLine(client, data.id);

      if (result.error) {
        return json(
          { error: result.error },
          await flash(
            request,
            error(result.error, "Failed to delete warehouse transfer line")
          )
        );
      }

      return json(
        { success: true },
        await flash(request, success("Deleted warehouse transfer line"))
      );
    }

    default:
      return json({ error: "Invalid action type" }, { status: 400 });
  }
}