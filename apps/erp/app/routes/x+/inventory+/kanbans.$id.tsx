import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  getKanban,
  KanbanForm,
  kanbanValidator,
  upsertKanban
} from "~/modules/inventory";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "inventory",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const kanban = await getKanban(id);

  return {
    kanban: kanban?.data ?? null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const formData = await request.formData();
  const validation = await validator(kanbanValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateKanban = await upsertKanban({
    id,
    ...d,
    updatedBy: userId
  });

  if (updateKanban.error) {
    return data(
      {},
      await flash(request, error(updateKanban.error, "Failed to update kanban"))
    );
  }

  throw redirect(
    `${path.to.kanbans}?${getParams(request)}`,
    await flash(request, success("Updated kanban"))
  );
}

export default function EditKanbanRoute() {
  const { kanban } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: kanban?.id ?? undefined,
    itemId: kanban?.itemId ?? "",
    quantity: kanban?.quantity ?? 1,
    replenishmentSystem: kanban?.replenishmentSystem ?? "Buy",
    locationId: kanban?.locationId ?? "",
    storageUnitId: kanban?.storageUnitId ?? "",
    supplierId: kanban?.supplierId ?? "",
    purchaseUnitOfMeasureCode: kanban?.purchaseUnitOfMeasureCode ?? "",
    conversionFactor: kanban?.conversionFactor ?? 1,
    autoRelease: kanban?.autoRelease ?? false,
    autoStartJob: kanban?.autoStartJob ?? false,
    completedBarcodeOverride: kanban?.completedBarcodeOverride ?? ""
  };

  return (
    <KanbanForm
      key={initialValues.id}
      initialValues={initialValues}
      locationId={initialValues.locationId}
      onClose={() => navigate(-1)}
    />
  );
}
