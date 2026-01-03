import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { Card, CardContent, HStack, VStack } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { data, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import {
  maintenanceDispatchItemValidator,
  upsertMaintenanceDispatchItem
} from "~/modules/resources";
import type { MaintenanceDispatchItem } from "~/modules/resources/types";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "resources"
  });

  const { dispatchId } = params;
  if (!dispatchId) throw new Error("dispatchId not found");

  const formData = await request.formData();
  const validation = await validator(maintenanceDispatchItemValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const upsertItem = await upsertMaintenanceDispatchItem(client, {
    ...validation.data,
    maintenanceDispatchId: dispatchId,
    createdBy: validation.data.id ? undefined : userId,
    // @ts-expect-error - stfu typescript
    updatedBy: validation.data.id ? userId : undefined
  });

  if (upsertItem.error) {
    return data(
      {},
      await flash(request, error(upsertItem.error, "Failed to save item"))
    );
  }

  return data({}, await flash(request, success("Item saved")));
}

export default function MaintenanceDispatchItemsRoute() {
  const { dispatchId } = useParams();
  if (!dispatchId) throw new Error("dispatchId not found");

  const routeData = useRouteData<{
    items: MaintenanceDispatchItem[];
  }>(path.to.maintenanceDispatch(dispatchId));

  const items = routeData?.items ?? [];

  return (
    <VStack spacing={4}>
      <HStack className="justify-between w-full">
        <h2 className="text-lg font-semibold">Parts & Materials</h2>
      </HStack>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No parts or materials recorded yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Card key={item.id}>
              <CardContent className="py-4">
                <div className="grid grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Item:</span>{" "}
                    {item.item?.name ?? item.itemId}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Quantity:</span>{" "}
                    {item.quantity} {item.unitOfMeasureCode}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Unit Cost:</span>{" "}
                    {item.unitCost
                      ? `$${Number(item.unitCost).toFixed(2)}`
                      : "-"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total Cost:</span>{" "}
                    {item.totalCost
                      ? `$${Number(item.totalCost).toFixed(2)}`
                      : "-"}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </VStack>
  );
}
