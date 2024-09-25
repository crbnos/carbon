import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import { json, redirect, useLoaderData, useParams } from "@remix-run/react";

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import {
  getQuoteMaterial,
  getQuoteMaterialsByMethodId,
  getQuoteOperationsByMethodId,
  QuoteBillOfMaterial,
  QuoteBillOfProcess,
  QuoteMaterialForm,
} from "~/modules/sales";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
  });

  const { quoteId, lineId, methodId, materialId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");
  if (!methodId) throw new Error("Could not find methodId");
  if (!materialId) throw new Error("Could not find materialId");

  const [material, materials, operations] = await Promise.all([
    getQuoteMaterial(client, materialId),
    getQuoteMaterialsByMethodId(client, methodId),
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

  if (materials.error) {
    throw redirect(
      path.to.quoteLine(quoteId, lineId),
      await flash(
        request,
        error(materials.error, "Failed to load quote materials")
      )
    );
  }

  if (operations.error) {
    throw redirect(
      path.to.quoteLine(quoteId, lineId),
      await flash(
        request,
        error(operations.error, "Failed to load quote operations")
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
    materials:
      materials?.data.map((m) => ({
        ...m,
        itemType: m.itemType as "Part",
        unitOfMeasureCode: m.unitOfMeasureCode ?? "",
        quoteOperationId: m.quoteOperationId ?? undefined,
      })) ?? [],
    operations:
      operations.data?.map((o) => ({
        ...o,
        description: o.description ?? "",
        workCenterId: o.workCenterId ?? undefined,
        laborRate: o.laborRate ?? 0,
        machineRate: o.machineRate ?? 0,
        operationSupplierProcessId: o.operationSupplierProcessId ?? undefined,
        quoteMakeMethodId: o.quoteMakeMethodId ?? methodId,
        workInstruction: o.workInstruction as JSONContent | null,
      })) ?? [],
  });
}

export default function QuoteMakeMethodRoute() {
  const { methodId } = useParams();
  if (!methodId) throw new Error("Could not find methodId");

  const loaderData = useLoaderData<typeof loader>();
  const { material, materials, operations } = loaderData;

  return (
    <VStack spacing={2} key={JSON.stringify(loaderData)}>
      <QuoteMaterialForm initialValues={material} operations={operations} />
      <QuoteBillOfProcess
        quoteMakeMethodId={methodId}
        operations={operations}
      />
      <QuoteBillOfMaterial
        quoteMakeMethodId={methodId}
        materials={materials}
        operations={operations}
      />
    </VStack>
  );
}
