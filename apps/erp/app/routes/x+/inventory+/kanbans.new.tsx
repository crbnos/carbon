import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useNavigate, useSearchParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useUser } from "~/hooks";
import { KanbanForm, kanbanValidator, upsertKanban } from "~/modules/inventory";
import { getParams, path } from "~/utils/path";

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

  const validation = await validator(kanbanValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  console.log({ data });

  const createKanban = await upsertKanban(client, {
    ...data,
    companyId,
    createdBy: userId,
  });

  if (createKanban.error) {
    return json(
      {},
      await flash(request, error(createKanban.error, "Failed to insert kanban"))
    );
  }

  throw redirect(
    `${path.to.kanbans}?${getParams(request)}`,
    await flash(request, success("Kanban created"))
  );
}

export default function NewKanbanRoute() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { defaults } = useUser();
  const locationId =
    (searchParams.get("location") || defaults.locationId) ?? "";

  const initialValues = {
    itemId: "",
    quantity: 1,
    replenishmentSystem: "Buy" as const,
    locationId,
    conversionFactor: 1,
    autoRelease: false,
    autoStartJob: false,
    completedBarcodeOverride: "",
  };

  return (
    <KanbanForm
      initialValues={initialValues}
      locationId={locationId}
      onClose={() => navigate(-1)}
    />
  );
}
