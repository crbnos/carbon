import { VStack } from "@carbon/react";
import { json, redirect, useLoaderData, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  getQuoteMaterial,
  getQuoteOperationsByMethodId,
  QuoteMaterialForm,
} from "~/modules/sales";
import { path } from "~/utils/path";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
  });

  const { quoteId, lineId, methodId, materialId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");
  if (!methodId) throw new Error("Could not find methodId");
  if (!materialId) throw new Error("Could not find materialId");

  const [material, operations] = await Promise.all([
    getQuoteMaterial(client, materialId),
    getQuoteOperationsByMethodId(client, methodId),
  ]);

  if (material.error) {
    throw redirect(
      path.to.quoteLine(quoteId, lineId),
      await flash(
        request,
        error(material.error, "Failed to load quote material")
      )
    );
  }

  return json({
    material: {
      ...material.data,
      id: material.data.id ?? "",
      description: material.data.description ?? "",
      itemId: material.data.itemId ?? "",
      itemReadableId: material.data.itemReadableId ?? "",
      itemType: material.data.itemType as "Part",
      methodType: material.data.methodType ?? "Make",
      order: material.data.order ?? 1,
      quantity: material.data.quantity ?? 0,
      quoteMakeMethodId: material.data.quoteMakeMethodId ?? "",
      quoteMaterialMakeMethodId: material.data.quoteMaterialMakeMethodId,
      quoteOperationId: material.data.quoteOperationId ?? undefined,
      unitCost: material.data.unitCost ?? 0,
      unitOfMeasureCode: material.data.unitOfMeasureCode ?? "",
    },
    operations:
      operations.data?.map((o) => ({
        ...o,
        description: o.description ?? "",
        laborRate: o.laborRate ?? 0,
        machineRate: o.machineRate ?? 0,
        operationSupplierProcessId: o.operationSupplierProcessId ?? undefined,
        quoteMakeMethodId: o.quoteMakeMethodId ?? methodId,
        workCenterId: o.workCenterId ?? undefined,
      })) ?? [],
  });
}

export default function QuoteMaterialBuyPage() {
  const { material, operations } = useLoaderData<typeof loader>();

  const { materialId } = useParams();
  if (!materialId) throw new Error("Could not find materialId");

  return (
    <VStack spacing={2}>
      <QuoteMaterialForm
        key={materialId}
        initialValues={material}
        operations={operations}
      />
    </VStack>
  );
}
