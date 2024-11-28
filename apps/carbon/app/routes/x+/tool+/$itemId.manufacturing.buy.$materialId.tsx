import { VStack } from "@carbon/react";
import { json, redirect, useLoaderData, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ItemForm, getItem, getMethodMaterial } from "~/modules/items";
import { path } from "~/utils/path";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId, materialId } = params;
  if (!itemId) throw new Error("Could not find itemId");
  if (!materialId) throw new Error("Could not find materialId");

  const [material] = await Promise.all([getMethodMaterial(client, materialId)]);

  if (material.error) {
    throw redirect(
      path.to.toolDetails(itemId),
      await flash(request, error(material.error, "Failed to load material"))
    );
  }

  const item = await getItem(client, material.data.itemId);
  if (item.error) {
    throw redirect(
      path.to.toolDetails(itemId),
      await flash(request, error(item.error, "Failed to load item"))
    );
  }

  return json({
    item: {
      ...item.data,
      defaultMethodType: item.data.defaultMethodType ?? "Buy",
      unitOfMeasureCode: item.data.unitOfMeasureCode ?? "EA",
      description: item.data.description ?? "",
    },
    material: material.data,
  });
}

export default function MethodMaterialBuyPage() {
  const { item } = useLoaderData<typeof loader>();
  const { itemId, materialId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  if (!materialId) throw new Error("Could not find materialId");

  return (
    <VStack spacing={2} className="p-2">
      <ItemForm
        key={`item:${itemId}:${materialId}`}
        type={item.type}
        initialValues={item}
      />
    </VStack>
  );
}
