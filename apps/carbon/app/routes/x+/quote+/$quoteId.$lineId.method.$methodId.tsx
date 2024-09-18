import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import { json, redirect, useLoaderData, useParams } from "@remix-run/react";

import {
  getQuoteMaterialsByMethodId,
  getQuoteOperationsByMethodId,
  QuoteBillOfMaterial,
  QuoteBillOfProcess,
} from "~/modules/sales";
import { path } from "~/utils/path";

import type { LoaderFunctionArgs } from "@remix-run/node";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
  });

  const { quoteId, lineId, methodId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");
  if (!methodId) throw new Error("Could not find methodId");

  const [materials, operations] = await Promise.all([
    getQuoteMaterialsByMethodId(client, methodId),
    getQuoteOperationsByMethodId(client, methodId),
  ]);

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
        workInstruction: o.workInstruction as JSONContent,
      })) ?? [],
  });
}

export default function QuoteMakeMethodRoute() {
  const { quoteId, lineId, methodId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");
  if (!methodId) throw new Error("Could not find methodId");

  const { materials, operations } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={2}>
      <QuoteBillOfProcess
        key={JSON.stringify(operations)}
        quoteMakeMethodId={methodId}
        operations={operations}
      />
      <QuoteBillOfMaterial
        key={JSON.stringify(materials)}
        quoteMakeMethodId={methodId}
        materials={materials}
        operations={operations}
      />
    </VStack>
  );
}
