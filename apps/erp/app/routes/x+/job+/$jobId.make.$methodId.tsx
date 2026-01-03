import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { JSONContent } from "@carbon/react";
import { Spinner, useMount, VStack } from "@carbon/react";
import { Suspense } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Await, redirect, useLoaderData, useParams } from "react-router";
import { CadModel } from "~/components";
import { usePanels } from "~/components/Layout";
import { usePermissions, useRouteData } from "~/hooks";
import type { Job } from "~/modules/production";
import {
  getJob,
  getJobMakeMethodById,
  getJobMaterialsByMethodId,
  getJobOperationsByMethodId,
  getPartDocuments,
  getProductionDataByOperations
} from "~/modules/production";
import {
  JobBillOfMaterial,
  JobBillOfProcess,
  JobDocuments,
  JobEstimatesVsActuals
} from "~/modules/production/ui/Jobs";
import JobMakeMethodTools from "~/modules/production/ui/Jobs/JobMakeMethodTools";
import { getModelByItemId, getTagsList } from "~/modules/shared";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    bypassRls: true
  });

  const { jobId, methodId } = params;
  if (!jobId) throw new Error("Could not find jobId");
  if (!methodId) throw new Error("Could not find methodId");

  const [job, makeMethod, materials, operations, tags] = await Promise.all([
    getJob(client, jobId),
    getJobMakeMethodById(client, methodId, companyId),
    getJobMaterialsByMethodId(client, methodId),
    getJobOperationsByMethodId(client, methodId),
    getTagsList(client, companyId, "operation")
  ]);

  if (job.error) {
    throw redirect(
      path.to.jobs,
      await flash(request, error(materials.error, "Failed to load job"))
    );
  }

  if (makeMethod.error) {
    throw redirect(
      path.to.job(jobId),
      await flash(
        request,
        error(makeMethod.error, "Failed to load job make method")
      )
    );
  }

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

  return {
    job: job.data,
    materials:
      materials?.data.map((m) => ({
        ...m,
        itemType: m.itemType as "Part",
        unitOfMeasureCode: m.unitOfMeasureCode ?? "",
        jobOperationId: m.jobOperationId ?? undefined
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
        workInstruction: o.workInstruction as JSONContent | null
      })) ?? [],
    makeMethod: makeMethod.data,
    productionData: getProductionDataByOperations(
      client,
      operations?.data?.map((o) => o.id)
    ),
    files: getPartDocuments(client, companyId, makeMethod.data),
    model: getModelByItemId(client, makeMethod.data.itemId!),
    tags: tags.data ?? []
  };
}

export default function JobMakeMethodRoute() {
  const permissions = usePermissions();
  const { methodId, jobId } = useParams();
  if (!methodId) throw new Error("Could not find methodId");
  if (!jobId) throw new Error("Could not find jobId");
  const routeData = useRouteData<{ job: Job }>(path.to.job(jobId));
  const loaderData = useLoaderData<typeof loader>();
  const {
    job,
    makeMethod,
    materials,
    operations,
    productionData,
    tags,
    files
  } = loaderData;

  const { setIsExplorerCollapsed, isExplorerCollapsed } = usePanels();

  useMount(() => {
    if (isExplorerCollapsed) {
      setIsExplorerCollapsed(false);
    }
  });

  return (
    <VStack spacing={2} className="p-2">
      <JobMakeMethodTools makeMethod={makeMethod} />

      <JobBillOfMaterial
        key={`bom:${methodId}`}
        jobMakeMethodId={methodId}
        materials={materials}
        // @ts-expect-error
        operations={operations}
      />
      <JobBillOfProcess
        key={`bop:${methodId}`}
        jobMakeMethodId={methodId}
        materials={materials}
        // @ts-expect-error
        operations={operations}
        locationId={routeData?.job?.locationId ?? ""}
        tags={tags}
        itemId={makeMethod.itemId}
        salesOrderLineId={job.salesOrderLineId ?? ""}
        customerId={job.customerId ?? ""}
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
              // @ts-expect-error
              operations={operations}
              productionEvents={resolvedProductionData.events}
              productionQuantities={resolvedProductionData.quantities}
              notes={resolvedProductionData.notes}
            />
          )}
        </Await>
      </Suspense>
      <Await resolve={files}>
        {(files) => (
          <JobDocuments
            files={files}
            jobId={jobId}
            bucket="parts"
            itemId={makeMethod.itemId}
            modelUpload={{ ...job }}
          />
        )}
      </Await>
      <Suspense fallback={null}>
        <Await resolve={loaderData.model}>
          {(model) => (
            <CadModel
              key={`cad:${model.itemId}`}
              isReadOnly={!permissions.can("update", "sales")}
              metadata={{
                itemId: model?.itemId ?? undefined
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
