import type { JSONContent } from "@carbon/react";
import { Spinner, VStack } from "@carbon/react";
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
import { useRouteData } from "~/hooks";
import type { Job } from "~/modules/production";
import {
  getJobMaterialsByMethodId,
  getJobOperationsByMethodId,
  getProductionDataByOperations,
  JobBillOfMaterial,
  JobBillOfProcess,
  JobEstimatesVsActuals,
} from "~/modules/production";
import JobMakeMethodTools from "~/modules/production/ui/Jobs/JobMakeMethodTools";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "production",
  });

  const { jobId, methodId } = params;
  if (!jobId) throw new Error("Could not find jobId");
  if (!methodId) throw new Error("Could not find methodId");

  const [materials, operations] = await Promise.all([
    getJobMaterialsByMethodId(client, methodId),
    getJobOperationsByMethodId(client, methodId),
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
    productionData: getProductionDataByOperations(
      client,
      operations?.data?.map((o) => o.id)
    ),
  });
}

export default function JobMakeMethodRoute() {
  const { methodId, jobId } = useParams();
  if (!methodId) throw new Error("Could not find methodId");
  if (!jobId) throw new Error("Could not find jobId");
  const routeData = useRouteData<{ job: Job }>(path.to.job(jobId));

  const loaderData = useLoaderData<typeof loader>();
  const { materials, operations, productionData } = loaderData;

  return (
    <div className="h-[calc(100dvh-49px)] w-full items-start overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
      <VStack spacing={2} className="p-2">
        <JobMakeMethodTools />
        <JobBillOfProcess
          key={`bop:${methodId}:${operations.length}:${operations[0]?.workCenterId}`}
          jobMakeMethodId={methodId}
          operations={operations}
          locationId={routeData?.job?.locationId ?? ""}
        />
        <JobBillOfMaterial
          key={`bom:${methodId}:${materials.length}`}
          jobMakeMethodId={methodId}
          materials={materials}
          operations={operations}
        />

        <Suspense
          fallback={
            <div className="flex w-full h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
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
              />
            )}
          </Await>
        </Suspense>
      </VStack>
    </div>
  );
}
