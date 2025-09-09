import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  KanbanForm,
  getKanban,
  kanbanValidator,
  upsertKanban,
} from "~/modules/inventory";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory",
    role: "employee",
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const kanban = await getKanban(client, id);

  return json({
    kanban: kanban?.data ?? null,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "inventory",
  });

  const formData = await request.formData();
  const validation = await validator(kanbanValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("id not found");

  const updateKanban = await upsertKanban(client, {
    id,
    ...data,
    updatedBy: userId,
  });

  if (updateKanban.error) {
    return json(
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
