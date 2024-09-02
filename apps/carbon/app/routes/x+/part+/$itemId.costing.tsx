import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getAccountsList } from "~/modules/accounting";
import {
  ItemCostingForm,
  getItemCost,
  itemCostValidator,
  upsertItemCost,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [itemCost, accounts] = await Promise.all([
    getItemCost(client, itemId, companyId),
    getAccountsList(client, companyId),
  ]);

  if (itemCost.error) {
    throw redirect(
      path.to.items,
      await flash(request, error(itemCost.error, "Failed to load part costing"))
    );
  }
  if (accounts.error) {
    throw redirect(
      path.to.items,
      await flash(request, error(accounts.error, "Failed to load accounts"))
    );
  }

  return json({
    itemCost: itemCost.data,
    accounts: accounts.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(itemCostValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateItemCost = await upsertItemCost(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updateItemCost.error) {
    throw redirect(
      path.to.part(itemId),
      await flash(
        request,
        error(updateItemCost.error, "Failed to update part costing")
      )
    );
  }

  throw redirect(
    path.to.partCosting(itemId),
    await flash(request, success("Updated part costing"))
  );
}

export default function PartCostingRoute() {
  const { itemCost } = useLoaderData<typeof loader>();
  return (
    <VStack spacing={2} className="p-2">
      <ItemCostingForm
        key={itemCost.itemId}
        initialValues={{
          ...itemCost,
          itemPostingGroupId: itemCost?.itemPostingGroupId ?? undefined,
          ...getCustomFields(itemCost.customFields),
        }}
      />
    </VStack>
  );
}
