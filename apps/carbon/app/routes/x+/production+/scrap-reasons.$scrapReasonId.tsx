import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getScrapReason,
  scrapReasonValidator,
  upsertScrapReason,
} from "~/modules/production";
import ScrapReasonForm from "~/modules/production/ui/ScrapReasonCodes/ScrapReasonForm";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "production",
    role: "employee",
  });

  const { scrapReasonId } = params;
  if (!scrapReasonId) throw notFound("scrapReasonId not found");

  const scrapReason = await getScrapReason(client, scrapReasonId);

  if (scrapReason.error) {
    throw redirect(
      path.to.scrapReasons,
      await flash(
        request,
        error(scrapReason.error, "Failed to get scrap reason")
      )
    );
  }

  return json({
    scrapReason: scrapReason.data,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "production",
  });

  const formData = await request.formData();
  const validation = await validator(scrapReasonValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("id not found");

  const updateScrapReason = await upsertScrapReason(client, {
    id,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateScrapReason.error) {
    return json(
      {},
      await flash(
        request,
        error(updateScrapReason.error, "Failed to update scrap reason")
      )
    );
  }

  throw redirect(
    path.to.scrapReasons,
    await flash(request, success("Updated scrap reason"))
  );
}

export default function EditScrapReasonRoute() {
  const { scrapReason } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: scrapReason.id ?? undefined,
    name: scrapReason.name ?? "",
    ...getCustomFields(scrapReason.customFields),
  };

  return (
    <ScrapReasonForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
