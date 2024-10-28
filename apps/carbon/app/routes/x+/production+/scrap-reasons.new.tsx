import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { scrapReasonValidator, upsertScrapReason } from "~/modules/production";
import ScrapReasonForm from "~/modules/production/ui/ScrapReasons/ScrapReasonForm";
import { setCustomFields } from "~/utils/form";
import { getParams, path, requestReferrer } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "production",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production",
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(scrapReasonValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertScrapReason = await upsertScrapReason(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertScrapReason.error) {
    return modal
      ? json(insertScrapReason)
      : redirect(
          requestReferrer(request) ??
            `${path.to.scrapReasons}?${getParams(request)}`,
          await flash(
            request,
            error(insertScrapReason.error, "Failed to insert scrap reason")
          )
        );
  }

  return modal
    ? json(insertScrapReason)
    : redirect(
        `${path.to.scrapReasons}?${getParams(request)}`,
        await flash(request, success("Scrap reason created"))
      );
}

export default function NewCustomerStatusesRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
  };

  return (
    <ScrapReasonForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
