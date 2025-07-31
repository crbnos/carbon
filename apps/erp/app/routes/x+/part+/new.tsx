import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { modelThumbnailTask } from "@carbon/jobs/trigger/model-thumbnail";
import { tasks } from "@trigger.dev/sdk/v3";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { partValidator, upsertPart } from "~/modules/items";
import { PartForm } from "~/modules/items/ui/Parts";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs",
};

export const handle: Handle = {
  breadcrumb: "Parts",
  to: path.to.parts,
  module: "items",
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(partValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const createPart = await upsertPart(client, {
    ...validation.data,
    companyId,
    customFields: setCustomFields(formData),
    createdBy: userId,
  });
  if (createPart.error) {
    return modal
      ? json(
          createPart,
          await flash(request, error(createPart.error, "Failed to insert part"))
        )
      : redirect(
          path.to.parts,
          await flash(request, error(createPart.error, "Failed to insert part"))
        );
  }

  if (validation.data.modelUploadId) {
    await tasks.trigger<typeof modelThumbnailTask>("model-thumbnail", {
      companyId,
      modelId: validation.data.modelUploadId,
    });
  }

  const itemId = createPart.data?.id;
  if (!itemId) throw new Error("Part ID not found");

  return modal
    ? json(createPart, { status: 201 })
    : redirect(path.to.part(itemId));
}

export default function PartsNewRoute() {
  const initialValues = {
    id: "",
    revision: "0",
    name: "",
    description: "",
    itemTrackingType: "Inventory" as "Inventory",
    replenishmentSystem: "Buy" as "Buy",
    defaultMethodType: "Buy" as "Buy",
    unitOfMeasureCode: "EA",
    unitCost: 0,
    lotSize: 0,
    active: true,
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <PartForm initialValues={initialValues} />
    </div>
  );
}
