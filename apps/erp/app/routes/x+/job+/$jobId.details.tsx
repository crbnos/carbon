import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  HStack,
  Spinner,
  useMount,
  VStack
} from "@carbon/react";
import { Suspense } from "react";
import { LuShoppingCart } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Await, redirect, useLoaderData, useParams } from "react-router";
import { CadModel, Hyperlink, SupplierAvatar } from "~/components";
import { usePanels } from "~/components/Layout";
import { usePermissions, useRealtime, useRouteData } from "~/hooks";
import type { Job, JobPurchaseOrderLine } from "~/modules/production";
import {
  getJob,
  getJobDocumentsWithItemId,
  getJobMakeMethodById,
  getJobMaterialsByMethodId,
  getJobOperationsByMethodId,
  getJobPurchaseOrderLines,
  getProductionDataByOperations,
  getRootMakeMethod,
  jobValidator,
  recalculateJobRequirements,
  upsertJob
} from "~/modules/production";
import {
  JobBillOfMaterial,
  JobBillOfProcess,
  JobDocuments,
  JobEstimatesVsActuals,
  JobNotes,
  JobRiskRegister
} from "~/modules/production/ui/Jobs";
import JobMakeMethodTools from "~/modules/production/ui/Jobs/JobMakeMethodTools";
import PurchasingStatus from "~/modules/purchasing/ui/PurchaseOrder/PurchasingStatus";
import { getTagsList } from "~/modules/shared";
import { useItems } from "~/stores";
import type { StorageItem } from "~/types";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    bypassRls: true
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const job = await getJob(client, jobId);
  if (job.error) {
    throw redirect(
      path.to.jobs,
      await flash(request, error(job.error, "Failed to load job"))
    );
  }

  const rootMethod = await getRootMakeMethod(client, jobId, companyId);
  if (rootMethod.error) {
    return {
      notes: (job.data?.notes ?? {}) as JSONContent,
      purchaseOrderLines: getJobPurchaseOrderLines(client, jobId),
      materials: [],
      operations: [],
      makeMethod: null,
      files: Promise.resolve([] as StorageItem[]),
      productionData: Promise.resolve({
        quantities: [],
        events: [],
        notes: []
      }),
      tags: []
    };
  }

  const methodId = rootMethod.data.id;

  const [materials, operations, tags, makeMethod] = await Promise.all([
    getJobMaterialsByMethodId(client, methodId),
    getJobOperationsByMethodId(client, methodId),
    getTagsList(client, companyId, "operation"),
    getJobMakeMethodById(client, methodId, companyId)
  ]);

  return {
    notes: (job.data?.notes ?? {}) as JSONContent,
    purchaseOrderLines: getJobPurchaseOrderLines(client, jobId),
    materials:
      materials?.data?.map((m) => ({
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
        workInstruction: o.workInstruction as JSONContent
      })) ?? [],
    makeMethod: makeMethod.data ?? null,
    files: getJobDocumentsWithItemId(
      client,
      companyId,
      job.data,
      rootMethod.data.itemId
    ),
    productionData: getProductionDataByOperations(
      client,
      operations?.data?.map((o) => o.id) ?? []
    ),
    tags: tags.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { jobId: id } = params;
  if (!id) throw new Error("Could not find jobId");

  const formData = await request.formData();
  const validation = await validator(jobValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { jobId, ...d } = validation.data;
  if (!jobId) throw new Error("Could not find jobId in payload");

  const updateJob = await upsertJob(client, {
    ...d,
    id: id,
    jobId,
    customFields: setCustomFields(formData),
    updatedBy: userId
  });
  if (updateJob.error) {
    throw redirect(
      path.to.job(id),
      await flash(request, error(updateJob.error, "Failed to update job"))
    );
  }

  const recalculate = await recalculateJobRequirements(getCarbonServiceRole(), {
    id,
    companyId,
    userId
  });
  if (recalculate.error) {
    throw redirect(
      path.to.job(id),
      await flash(
        request,
        error(recalculate.error, "Failed to recalculate job requirements")
      )
    );
  }

  throw redirect(path.to.job(id), await flash(request, success("Updated job")));
}

export default function JobDetailsRoute() {
  const {
    notes,
    purchaseOrderLines,
    materials,
    operations,
    makeMethod,
    productionData,
    tags,
    files
  } = useLoaderData<typeof loader>();
  const { jobId } = useParams();
  if (!jobId) throw new Error("Could not find jobId");
  const permissions = usePermissions();

  const { setIsExplorerCollapsed, isExplorerCollapsed } = usePanels();

  useMount(() => {
    if (isExplorerCollapsed) {
      setIsExplorerCollapsed(false);
    }
  });

  const jobData = useRouteData<{
    job: Job;
    files: Promise<StorageItem[]> | StorageItem[];
  }>(path.to.job(jobId));

  if (!jobData) throw new Error("Could not find job data");

  useRealtime("modelUpload", `modelPath=eq.(${jobData?.job.modelPath})`);

  const methodId = makeMethod?.id;

  return (
    <div className="h-[calc(100dvh-49px)] w-full items-start overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
      <VStack spacing={2} className="p-2">
        <JobMakeMethodTools makeMethod={makeMethod ?? undefined} />

        <JobNotes
          id={jobId}
          title={jobData?.job.jobId ?? ""}
          subTitle={jobData?.job.itemReadableIdWithRevision ?? ""}
          notes={notes}
        />

        {methodId && (
          <>
            <JobBillOfMaterial
              key={`bom:${methodId}`}
              jobMakeMethodId={methodId}
              // @ts-ignore
              materials={materials}
              // @ts-ignore
              operations={operations}
            />
            <JobBillOfProcess
              key={`bop:${methodId}`}
              jobMakeMethodId={methodId}
              // @ts-ignore
              materials={materials}
              // @ts-ignore
              operations={operations}
              locationId={jobData?.job?.locationId ?? ""}
              tags={tags}
              itemId={makeMethod.itemId}
              salesOrderLineId={jobData?.job.salesOrderLineId ?? ""}
              customerId={jobData?.job.customerId ?? ""}
            />
          </>
        )}
        <Suspense>
          <Await resolve={purchaseOrderLines}>
            {(purchaseOrderLines) => (
              <JobPurchaseOrderLines
                purchaseOrderLines={purchaseOrderLines.data ?? []}
              />
            )}
          </Await>
        </Suspense>

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
                // @ts-ignore
                materials={materials ?? []}
                // @ts-ignore
                operations={operations}
                productionEvents={resolvedProductionData.events}
                productionQuantities={resolvedProductionData.quantities}
                notes={resolvedProductionData.notes}
              />
            )}
          </Await>
        </Suspense>

        <Suspense
          fallback={
            <div className="flex w-full h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center min-h-[420px] max-h-[70vh]">
              <Spinner className="h-10 w-10" />
            </div>
          }
        >
          <Await resolve={files}>
            {(resolvedFiles) => (
              <JobDocuments
                files={resolvedFiles}
                jobId={jobData.job.id ?? ""}
                bucket="parts"
                itemId={makeMethod?.itemId ?? jobData.job.itemId}
                modelUpload={{ ...jobData.job }}
              />
            )}
          </Await>
        </Suspense>

        <CadModel
          isReadOnly={!permissions.can("update", "production")}
          metadata={{
            jobId: jobData?.job?.id ?? undefined,
            itemId: jobData?.job?.itemId ?? undefined
          }}
          modelPath={jobData?.job?.modelPath ?? null}
          title="CAD Model"
          uploadClassName="aspect-square min-h-[420px] max-h-[70vh]"
          viewerClassName="aspect-square min-h-[420px] max-h-[70vh]"
        />
        <JobRiskRegister jobId={jobId} itemId={jobData?.job?.itemId ?? ""} />
      </VStack>
    </div>
  );
}

function JobPurchaseOrderLines({
  purchaseOrderLines
}: {
  purchaseOrderLines: JobPurchaseOrderLine[];
}) {
  if (purchaseOrderLines.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Purchase Orders</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="border rounded-lg">
          {purchaseOrderLines.map((line, index) => (
            <div
              key={line.id}
              className={cn(
                "border-b p-6",
                index === purchaseOrderLines.length - 1 && "border-b-0"
              )}
            >
              <JobPurchaseOrderLineItem line={line} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function JobPurchaseOrderLineItem({ line }: { line: JobPurchaseOrderLine }) {
  const [items] = useItems();
  const item = items.find((i) => i.id === line.itemId);

  const isPartiallyShipped = (line.quantityShipped ?? 0) > 0;
  const isShipped = (line.quantityShipped ?? 0) >= (line.purchaseQuantity ?? 0);

  const isPartiallyReceived = (line.quantityReceived ?? 0) > 0;
  const isReceived =
    (line.quantityReceived ?? 0) >= (line.purchaseQuantity ?? 0);

  const status = isReceived
    ? "Received"
    : isPartiallyReceived
      ? "Partially Received"
      : isShipped
        ? "Shipped"
        : isPartiallyShipped
          ? "Partially Shipped"
          : "To Ship";

  const statusColor = isReceived
    ? "green"
    : isPartiallyReceived
      ? "yellow"
      : isShipped
        ? "blue"
        : isPartiallyShipped
          ? "orange"
          : "gray";

  return (
    <div className="flex flex-1 justify-between items-center w-full">
      <HStack spacing={4} className="w-2/3">
        <HStack spacing={4} className="flex-1">
          <div className="bg-muted border rounded-full flex items-center justify-center p-2">
            <LuShoppingCart className="size-4" />
          </div>
          <VStack spacing={0}>
            <Hyperlink
              className="text-sm font-medium"
              to={path.to.purchaseOrder(line.purchaseOrder.id)}
            >
              {line.purchaseOrder.purchaseOrderId}
            </Hyperlink>
            <PurchasingStatus status={line.purchaseOrder.status} />
          </VStack>
          <VStack className="items-center" spacing={0}>
            <span className="text-sm font-medium text-center">
              {item?.readableIdWithRevision}
            </span>
            <span className="text-xs text-muted-foreground text-center">
              {item?.name}
            </span>
          </VStack>
        </HStack>
      </HStack>
      <div className="flex flex-col items-end justify-center gap-1">
        <SupplierAvatar
          className="text-sm"
          supplierId={line.purchaseOrder.supplierId}
        />
        <Badge variant={statusColor}>{status}</Badge>
      </div>
    </div>
  );
}
