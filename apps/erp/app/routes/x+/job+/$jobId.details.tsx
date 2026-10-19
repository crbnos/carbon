// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
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
import { redirect } from "@carbon/utils";
import { Suspense } from "react";
import { LuShoppingCart } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Await, useLoaderData, useParams } from "react-router";
import {
  CadModel,
  DeferredFiles,
  Hyperlink,
  SupplierAvatar
} from "~/components";
import { usePanels } from "~/components/Layout";
import { usePermissions, useRouteData } from "~/hooks";
import {
  JOB_LOCKED_MESSAGE,
  jobValidator
} from "~/modules/production/production.models";
import {
  getJob,
  getJobDocumentsWithItemId,
  getJobMakeMethodById,
  getJobMaterialsByMethodId,
  getJobOperationsByMethodId,
  getJobPurchaseOrderLines,
  getProductionDataByOperations,
  getRootMakeMethod
} from "~/modules/production/production.service";
import type { Job, JobPurchaseOrderLine } from "~/modules/production/types";
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
import {
  getTagsList,
  requireCompanyRecord
} from "~/modules/shared/shared.service";
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

  // `client` is the service role (bypassRls) and every read keys on the URL id,
  // so the job must be this company's. The check runs beside the reads it
  // guards, not before them: it rejects the whole batch, and nothing read here
  // is returned unless it passes.
  const [, job, rootMethod, tags] = await Promise.all([
    requireCompanyRecord(client, "job", companyId, { id: jobId }),
    getJob(client, jobId),
    getRootMakeMethod(client, jobId, companyId),
    getTagsList(client, companyId, "operation")
  ]);
  if (job.error) {
    throw redirect(
      path.to.jobs,
      await flash(request, error(job.error, "Failed to load job"))
    );
  }

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

  const [materials, operations, makeMethod] = await Promise.all([
    getJobMaterialsByMethodId(client, methodId),
    getJobOperationsByMethodId(client, methodId),
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

export async function action(args: ActionFunctionArgs) {
  const input = await validator(jobValidator).request(args, {
    params: ["jobId"]
  });
  if ("invalid" in input) return input.invalid;
  const { jobId } = input.params;
  const api = await carbon(args.request);
  const result = await api.production.updateJobDetails({
    ...input.data,
    id: jobId,
    customFields: setCustomFields(input.formData ?? new FormData())
  });
  // The item cannot complete to the job's asset: say so on the item field.
  if (
    result.error?.category === "rule" &&
    result.error.message !== JOB_LOCKED_MESSAGE
  ) {
    return validationError({ fieldErrors: { itemId: result.error.message } });
  }
  return respond(args.request, result).redirect(path.to.job(jobId), {
    message: "Updated job"
  });
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

  const jobData = useRouteData<{ job: Job }>(path.to.job(jobId));

  if (!jobData) throw new Error("Could not find job data");

  const methodId = makeMethod?.id;

  return (
    <div className="h-full w-full items-start overflow-y-auto scrollbar-hide">
      <VStack spacing={4} className="p-4">
        <JobMakeMethodTools makeMethod={makeMethod ?? undefined} />

        <JobNotes
          id={jobId}
          title={jobData?.job.jobId ?? ""}
          subTitle={jobData?.job.itemReadableIdWithRevision ?? ""}
          notes={notes}
        />

        {methodId && (
          <>
            <JobBillOfProcess
              key={`bop:${methodId}`}
              jobMakeMethodId={methodId}
              materials={materials}
              // @ts-expect-error
              operations={operations}
              locationId={jobData?.job?.locationId ?? ""}
              tags={tags}
              itemId={makeMethod.itemId}
              salesOrderLineId={jobData?.job.salesOrderLineId ?? ""}
              customerId={jobData?.job.customerId ?? ""}
            />
            <JobBillOfMaterial
              key={`bom:${methodId}`}
              jobMakeMethodId={methodId}
              // @ts-expect-error
              materials={materials}
              // @ts-expect-error
              operations={operations}
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

        <DeferredFiles resolve={files}>
          {(resolvedFiles) => (
            <JobDocuments
              files={resolvedFiles}
              jobId={jobData.job.id ?? ""}
              bucket="parts"
              itemId={makeMethod?.itemId ?? jobData.job.itemId}
              modelUpload={{ ...jobData.job }}
            />
          )}
        </DeferredFiles>

        <CadModel
          isReadOnly={!permissions.can("update", "production")}
          metadata={{
            jobId: jobData?.job?.id ?? undefined,
            itemId: jobData?.job?.itemId ?? undefined
          }}
          modelUpload={jobData?.job ?? null}
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
