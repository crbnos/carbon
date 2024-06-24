import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { ToolForm, toolValidator, upsertTool } from "~/modules/items";
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

  const validation = await validator(toolValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const createTool = await upsertTool(client, {
    ...validation.data,
    companyId,
    customFields: setCustomFields(formData),
    createdBy: userId,
  });
  if (createTool.error) {
    return modal
      ? json(
          createTool,
          await flash(request, error(createTool.error, "Failed to insert tool"))
        )
      : redirect(
          path.to.tools,
          await flash(request, error(createTool.error, "Failed to insert tool"))
        );
  }

  const itemId = createTool.data?.itemId;
  if (!itemId) throw new Error("Tool ID not found");

  return modal
    ? json(createTool, { status: 201 })
    : redirect(path.to.tool(itemId));
}

export default function ToolsNewRoute() {
  const initialValues = {
    id: "",
    name: "",
    description: "",
    replenishmentSystem: "Buy" as const,
    defaultMethodType: "Buy" as const,
    itemTrackingType: "Inventory" as "Inventory",
    unitOfMeasureCode: "EA",
    active: true,
  };

  return (
    <div className="w-1/2 max-w-[600px] min-w-[420px] mx-auto mt-8">
      <ToolForm initialValues={initialValues} />
    </div>
  );
}
