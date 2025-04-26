import type { JSONContent } from "@carbon/react";
import { Spinner, useMount, VStack } from "@carbon/react";
import {
  Await,
  defer,
  redirect,
  useLoaderData,
  useParams,
} from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Suspense } from "react";
import { CadModel } from "~/components";
import { usePanels } from "~/components/Layout";
import { usePermissions, useRouteData } from "~/hooks";
import type { Job } from "~/modules/production";
import {
  getJobMakeMethodById,
  getJobMaterialsByMethodId,
  getJobOperationsByMethodId,
  getProductionDataByOperations,
} from "~/modules/production";
import {
  JobBillOfMaterial,
  JobBillOfProcess,
  JobEstimatesVsActuals,
} from "~/modules/production/ui/Jobs";
import JobMakeMethodTools from "~/modules/production/ui/Jobs/JobMakeMethodTools";
import { getTagsList } from "~/modules/shared";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    bypassRls: true,
  });

  const { jobId, methodId } = params;
  if (!jobId) throw new Error("Could not find jobId");
  if (!methodId) throw new Error("Could not find methodId");

  const [materials, operations, tags, makeMethod] = await Promise.all([
    getJobMaterialsByMethodId(client, methodId),
    getJobOperationsByMethodId(client, methodId),
    getTagsList(client, companyId, "operation"),
    getJobMakeMethodById(client, methodId),
  ]);

  if (materials.error) {
    throw redirect(
      path.to.job(jobId),
      await flash(
        request,
        error(materials.error, "Failed to load job materials")
      )
    );
  }

  if (operations.error) {
    throw redirect(
      path.to.job(jobId),
      await flash(
        request,
        error(operations.error, "Failed to load job operations")
      )
    );
  }

  if (makeMethod.error) {
    throw redirect(
      path.to.job(jobId),
      await flash(
        request,
        error(makeMethod.error, "Failed to load make method")
      )
    );
  }

  return defer({
    materials:
      materials?.data.map((m) => ({
        ...m,
        itemType: m.itemType as "Part",
        unitOfMeasureCode: m.unitOfMeasureCode ?? "",
        jobOperationId: m.jobOperationId ?? undefined,
      })) ?? [],
    operations:
      operations.data?.map((o) => ({
        ...o,
        description: o.description ?? "",
        workCenterId: o.workCenterId ?? undefined,
        laborRate: o.laborRate ?? 0,
        machineRate: o.machineRate ?? 0,
        operationSupplierProcessId: o.operationSupplierProcessId ?? undefined,
        jobMakeMethodId: o.jobMakeMethodId ?? methodId,
        workInstruction: o.workInstruction as JSONContent,
      })) ?? [],
    makeMethod: makeMethod.data,
    productionData: getProductionDataByOperations(
      client,
      operations?.data?.map((o) => o.id)
    ),
    tags: tags.data ?? [],
  });
}

export default function JobMakeMethodRoute() {
  const { makeMethod } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const { methodId, jobId } = useParams();
  if (!methodId) throw new Error("Could not find methodId");
  if (!jobId) throw new Error("Could not find jobId");
  const routeData = useRouteData<{ job: Job }>(path.to.job(jobId));

  const loaderData = useLoaderData<typeof loader>();
  const { materials, operations, productionData, tags } = loaderData;

  const { setIsExplorerCollapsed, isExplorerCollapsed } = usePanels();

  useMount(() => {
    if (isExplorerCollapsed) {
      setIsExplorerCollapsed(false);
    }
  });

  return (
    <div className="h-[calc(100dvh-49px)] w-full items-start overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
      <VStack spacing={2} className="p-2">
        <JobMakeMethodTools makeMethod={makeMethod} />
        <JobBillOfProcess
          key={`bop:${methodId}`}
          jobMakeMethodId={methodId}
          operations={operations}
          locationId={routeData?.job?.locationId ?? ""}
          tags={tags}
        />
        <JobBillOfMaterial
          key={`bom:${methodId}`}
          jobMakeMethodId={methodId}
          materials={materials}
          operations={operations}
        />

        <Suspense
          fallback={
            <div className="flex w-full h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center min-h-[200px]">
              <Spinner className="h-10 w-10" />
            </div>
          }
        >
          <Await resolve={productionData}>
            {(resolvedProductionData) => (
              <JobEstimatesVsActuals
                materials={materials ?? []}
                operations={operations}
                productionEvents={resolvedProductionData.events}
                productionQuantities={resolvedProductionData.quantities}
                notes={resolvedProductionData.notes}
              />
            )}
          </Await>
        </Suspense>

        <CadModel
          isReadOnly={!permissions.can("update", "production")}
          metadata={{
            jobId: routeData?.job?.id ?? undefined,
            itemId: routeData?.job?.itemId ?? undefined,
          }}
          modelPath={routeData?.job?.modelPath ?? null}
          title="CAD Model"
          uploadClassName="aspect-square min-h-[420px] max-h-[70vh]"
          viewerClassName="aspect-square min-h-[420px] max-h-[70vh]"
        />
      </VStack>
    </div>
  );
}
