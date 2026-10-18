// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize, dataOrThrow } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { Suspense } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Await, useLoaderData, useParams } from "react-router";
import { CadModel } from "~/components";
import { usePermissions } from "~/hooks";
import {
  QuoteBillOfMaterial,
  QuoteBillOfProcess,
  QuoteMakeMethodTools
} from "~/modules/sales/ui/Quotes";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "sales"
  });

  const { quoteId, lineId, methodId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");
  if (!methodId) throw new Error("Could not find methodId");

  const [makeMethod, materials, operations, tags] = await Promise.all([
    api.sales.getQuoteMakeMethod({ quoteMakeMethodId: methodId }),
    api.sales.getQuoteMaterialsByMethodId({ quoteMakeMethodId: methodId }),
    api.sales.getQuoteOperationsByMethodId({ quoteMakeMethodId: methodId }),
    api.shared.getTagsList({ table: "operation" })
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

  return {
    makeMethod: makeMethod.data,
    materials:
      materials?.data.map((m) => ({
        ...m,
        description: m.description ?? "",
        itemType: m.itemType as "Part",
        unitOfMeasureCode: m.unitOfMeasureCode ?? "",
        quoteOperationId: m.quoteOperationId ?? undefined
      })) ?? [],
    operations:
      operations.data?.map((o) => ({
        ...o,
        description: o.description ?? "",
        procedureId: o.procedureId ?? undefined,
        assemblyInstructionId: o.assemblyInstructionId ?? undefined,
        inspectionDocumentId: o.inspectionDocumentId ?? undefined,
        workCenterId: o.workCenterId ?? undefined,
        laborRate: o.laborRate ?? 0,
        machineRate: o.machineRate ?? 0,
        operationSupplierProcessId: o.operationSupplierProcessId ?? undefined,
        quoteMakeMethodId: o.quoteMakeMethodId ?? methodId,
        workInstruction: o.workInstruction as JSONContent | null,
        tags: o.tags ?? []
      })) ?? [],
    tags: tags.data ?? [],
    model: api.shared
      .getModelByItemId({ itemId: makeMethod.data.itemId! })
      .then(dataOrThrow)
  };
}

export default function QuoteMakeMethodRoute() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { methodId } = useParams();
  if (!methodId) throw new Error("Could not find methodId");

  const loaderData = useLoaderData<typeof loader>();
  const { makeMethod, materials, operations, tags } = loaderData;

  return (
    <VStack spacing={4}>
      <QuoteMakeMethodTools />

      <QuoteBillOfProcess
        key={`bop:${methodId}`}
        quoteMakeMethodId={methodId}
        itemId={makeMethod.itemId ?? ""}
        materials={materials}
        // @ts-expect-error
        operations={operations}
        tags={tags}
      />
      <QuoteBillOfMaterial
        key={`bom:${methodId}`}
        quoteMakeMethodId={methodId}
        // @ts-expect-error TS2322 - TODO: fix type
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
                itemId: model?.itemId ?? undefined
              }}
              modelUpload={model ?? null}
              title={t`CAD Model`}
              uploadClassName="aspect-square min-h-[420px] max-h-[70vh]"
              viewerClassName="aspect-square min-h-[420px] max-h-[70vh]"
            />
          )}
        </Await>
      </Suspense>
    </VStack>
  );
}
