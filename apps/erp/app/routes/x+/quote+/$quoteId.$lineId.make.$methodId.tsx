import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import {
  Await,
  defer,
  redirect,
  useLoaderData,
  useParams,
} from "@remix-run/react";

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { Suspense } from "react";
import { CadModel } from "~/components";
import { usePermissions } from "~/hooks";
import {
  getQuoteMakeMethod,
  getQuoteMaterialsByMethodId,
  getQuoteOperationsByMethodId,
} from "~/modules/sales";
import {
  QuoteBillOfMaterial,
  QuoteBillOfProcess,
  QuoteMakeMethodTools,
} from "~/modules/sales/ui/Quotes";
import { getModelByItemId, getTagsList } from "~/modules/shared";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const { quoteId, lineId, methodId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");
  if (!methodId) throw new Error("Could not find methodId");

  const [makeMethod, materials, operations, tags] = await Promise.all([
    getQuoteMakeMethod(client, methodId),
    getQuoteMaterialsByMethodId(client, methodId),
    getQuoteOperationsByMethodId(client, methodId),
    getTagsList(client, companyId, "operation"),
  ]);

  if (makeMethod.error) {
    throw redirect(
      path.to.quoteLine(quoteId, lineId),
      await flash(
        request,
        error(makeMethod.error, "Failed to load quote make method")
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

  return defer({
    makeMethod: makeMethod.data,
    materials:
      materials?.data.map((m) => ({
        ...m,
        description: m.description ?? "",
        itemType: m.itemType as "Part",
        unitOfMeasureCode: m.unitOfMeasureCode ?? "",
        quoteOperationId: m.quoteOperationId ?? undefined,
      })) ?? [],
    operations:
      operations.data?.map((o) => ({
        ...o,
        description: o.description ?? "",
        procedureId: o.procedureId ?? undefined,
        workCenterId: o.workCenterId ?? undefined,
        laborRate: o.laborRate ?? 0,
        machineRate: o.machineRate ?? 0,
        operationSupplierProcessId: o.operationSupplierProcessId ?? undefined,
        quoteMakeMethodId: o.quoteMakeMethodId ?? methodId,
        workInstruction: o.workInstruction as JSONContent | null,
        tags: o.tags ?? [],
      })) ?? [],
    tags: tags.data ?? [],
    model: getModelByItemId(client, makeMethod.data.itemId!),
  });
}

export default function QuoteMakeMethodRoute() {
  const permissions = usePermissions();
  const { methodId } = useParams();
  if (!methodId) throw new Error("Could not find methodId");

  const loaderData = useLoaderData<typeof loader>();
  const { materials, operations, tags } = loaderData;

  return (
    <VStack spacing={2}>
      <QuoteMakeMethodTools />

      <QuoteBillOfProcess
        key={`bop:${methodId}`}
        quoteMakeMethodId={methodId}
        // @ts-ignore
        operations={operations}
        tags={tags}
      />
      <QuoteBillOfMaterial
        key={`bom:${methodId}`}
        quoteMakeMethodId={methodId}
        materials={materials}
        operations={operations}
      />
      <Suspense fallback={null}>
        <Await resolve={loaderData.model}>
          {(model) => (
            <CadModel
              key={`cad:${model.itemId}`}
              isReadOnly={!permissions.can("update", "sales")}
              metadata={{
                itemId: model?.itemId ?? undefined,
              }}
              modelPath={model?.modelPath ?? null}
              title="CAD Model"
              uploadClassName="aspect-square min-h-[420px] max-h-[70vh]"
              viewerClassName="aspect-square min-h-[420px] max-h-[70vh]"
            />
          )}
        </Await>
      </Suspense>
    </VStack>
  );
}
