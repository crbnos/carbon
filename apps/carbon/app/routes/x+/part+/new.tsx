import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { PartForm, partValidator, upsertPart } from "~/modules/parts";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

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
    active: true,
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
          path.to.partsSearch,
          await flash(request, error(createPart.error, "Failed to insert part"))
        );
  }

  const partId = createPart.data?.id;
  if (!partId) throw new Error("Part ID not found");

  return modal
    ? json(createPart, { status: 201 })
    : redirect(path.to.part(partId));
}

export default function PartsNewRoute() {
  const initialValues = {
    id: "",
    name: "",
    description: "",
    partType: "Inventory" as "Inventory",
    replenishmentSystem: "Buy" as "Buy",
    unitOfMeasureCode: "EA",
    blocked: false,
    active: false,
  };

  return (
    <div className="w-1/2 max-w-[600px] min-w-[420px] mx-auto">
      <PartForm initialValues={initialValues} />
    </div>
  );
}
