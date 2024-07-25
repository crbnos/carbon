import { VStack } from "@carbon/react";
import { json, redirect, useLoaderData, useParams } from "@remix-run/react";

import {
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

  const [operations] = await Promise.all([
    getQuoteOperationsByMethodId(client, methodId),
  ]);

  if (operations.error) {
    throw redirect(
      path.to.quoteLine(quoteId, lineId),
      await flash(
        request,
        error(operations.error, "Failed to load quote method")
      )
    );
  }

  return json({
    operations:
      operations.data?.map((o) => ({
        ...o,
        description: o.description ?? "",
        equipmentTypeId: o.equipmentTypeId ?? undefined,
        quoteMakeMethodId: o.quoteMakeMethodId ?? methodId,
      })) ?? [],
  });
}

export default function QuoteMakeMethodRoute() {
  const { methodId } = useParams();
  if (!methodId) throw new Error("Could not find methodId");

  const { operations } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={2} className="p-2">
      <QuoteBillOfProcess
        key={`bop:${methodId}`}
        quoteMakeMethodId={methodId}
        operations={operations}
      />
      <QuoteBillOfMaterial
        key={`bom:${methodId}`}
        quoteMakeMethodId={methodId}
        materials={[]}
        operations={operations}
      />
    </VStack>
  );
}
