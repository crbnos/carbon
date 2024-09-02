import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { PartForm, partValidator, upsertPart } from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

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

  const itemId = createPart.data?.itemId;
  if (!itemId) throw new Error("Part ID not found");

  return modal
    ? json(createPart, { status: 201 })
    : redirect(path.to.part(itemId));
}

export default function PartsNewRoute() {
  const initialValues = {
    id: "",
    name: "",
    description: "",
    itemTrackingType: "Inventory" as "Inventory",
    replenishmentSystem: "Buy" as "Buy",
    defaultMethodType: "Buy" as "Buy",
    unitOfMeasureCode: "EA",
    active: true,
  };

  return (
    <div className="w-1/2 max-w-[600px] min-w-[420px] mx-auto mt-8">
      <PartForm initialValues={initialValues} />
    </div>
  );
}
