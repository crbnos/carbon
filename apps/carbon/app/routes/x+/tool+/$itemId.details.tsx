import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { Card, CardHeader, CardTitle, VStack } from "@carbon/react";
import { Await, useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { Suspense } from "react";
import { usePermissions, useRouteData } from "~/hooks";
import type { ItemFile, ToolSummary } from "~/modules/items";
import {
  ItemDocuments,
  ToolForm,
  toolValidator,
  upsertTool,
} from "~/modules/items";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(toolValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateTool = await upsertTool(client, {
    ...validation.data,
    id: itemId,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });
  if (updateTool.error) {
    throw redirect(
      path.to.tool(itemId),
      await flash(request, error(updateTool.error, "Failed to update tool"))
    );
  }

  throw redirect(
    path.to.tool(itemId),
    await flash(request, success("Updated tool"))
  );
}

export default function ToolDetailsRoute() {
  const permissions = usePermissions();

  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const toolData = useRouteData<{
    toolSummary: ToolSummary;
    files: Promise<ItemFile[]>;
  }>(path.to.tool(itemId));
  if (!toolData) throw new Error("Could not find tool data");

  const toolInitialValues = {
    id: toolData.toolSummary?.id ?? "",
    itemId: toolData.toolSummary?.itemId ?? "",
    name: toolData.toolSummary?.name ?? "",
    description: toolData.toolSummary?.description ?? "",
    replenishmentSystem: toolData.toolSummary?.replenishmentSystem ?? "Buy",
    defaultMethodType: toolData.toolSummary?.defaultMethodType ?? "Buy",
    itemTrackingType: toolData.toolSummary?.itemTrackingType ?? "Inventory",
    active: toolData.toolSummary?.active ?? true,
    unitOfMeasureCode: toolData.toolSummary?.unitOfMeasureCode ?? "EA",
    ...getCustomFields(toolData.toolSummary?.customFields ?? {}),
  };

  return (
    <VStack spacing={2} className="w-full h-full">
      <ToolForm
        key={JSON.stringify(toolInitialValues)}
        initialValues={toolInitialValues}
      />
      {permissions.is("employee") && (
        <Suspense
          fallback={
            <Card className="flex-grow">
              <CardHeader>
                <CardTitle>Files</CardTitle>
              </CardHeader>
            </Card>
          }
        >
          <Await resolve={toolData?.files}>
            {(files) => (
              <ItemDocuments files={files ?? []} itemId={itemId} type="Tool" />
            )}
          </Await>
        </Suspense>
      )}
    </VStack>
  );
}
