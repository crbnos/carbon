import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { toolValidator, upsertTool } from "~/modules/items";
import { ToolForm } from "~/modules/items/ui/Tools";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Tools",
  to: path.to.tools,
  module: "items",
};

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

  const itemId = createTool.data?.id;
  if (!itemId) throw new Error("Tool ID not found");

  return modal
    ? json(createTool, { status: 201 })
    : redirect(path.to.tool(itemId));
}

export default function ToolsNewRoute() {
  const initialValues = {
    id: "",
    revision: "0",
    name: "",
    description: "",
    replenishmentSystem: "Buy" as const,
    defaultMethodType: "Buy" as const,
    itemTrackingType: "Inventory" as "Inventory",
    unitOfMeasureCode: "EA",
    unitCost: 0,
    active: true,
    tags: [],
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <ToolForm initialValues={initialValues} />
    </div>
  );
}
