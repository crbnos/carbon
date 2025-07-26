import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success,
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
  VStack,
} from "@carbon/react";
import { Await, useLoaderData, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { Suspense } from "react";
import { LuShoppingCart } from "react-icons/lu";
import { CadModel, Hyperlink, SupplierAvatar } from "~/components";
import { usePanels } from "~/components/Layout";
import { usePermissions, useRealtime, useRouteData } from "~/hooks";
import type { Job, JobPurchaseOrderLine } from "~/modules/production";
import {
  getJob,
  getJobPurchaseOrderLines,
  jobValidator,
  recalculateJobRequirements,
  upsertJob,
} from "~/modules/production";
import { JobDocuments, JobNotes } from "~/modules/production/ui/Jobs";
import PurchasingStatus from "~/modules/purchasing/ui/PurchaseOrder/PurchasingStatus";
import { useItems } from "~/stores";
import type { StorageItem } from "~/types";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "production",
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

  return defer({
    notes: (job.data?.notes ?? {}) as JSONContent,
    purchaseOrderLines: getJobPurchaseOrderLines(client, jobId),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production",
  });

  const { jobId: id } = params;
  if (!id) throw new Error("Could not find jobId");

  const formData = await request.formData();
  const validation = await validator(jobValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { jobId, ...data } = validation.data;
  if (!jobId) throw new Error("Could not find jobId in payload");

  const updateJob = await upsertJob(client, {
    ...data,
    id: id,
    jobId,
    customFields: setCustomFields(formData),
    updatedBy: userId,
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
    userId,
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
  const { notes, purchaseOrderLines } = useLoaderData<typeof loader>();
  const { jobId } = useParams();
  if (!jobId) throw new Error("Could not find jobId");
  const permissions = usePermissions();

  const { setIsExplorerCollapsed } = usePanels();

  useMount(() => {
    setIsExplorerCollapsed(false);
  });

  const jobData = useRouteData<{
    job: Job;
    files: Promise<StorageItem[]> | StorageItem[];
  }>(path.to.job(jobId));

  if (!jobData) throw new Error("Could not find job data");

  useRealtime("modelUpload", `modelPath=eq.(${jobData?.job.modelPath})`);

  return (
    <VStack spacing={2} className="p-2 h-full">
      <JobNotes
        id={jobId}
        title={jobData?.job.jobId ?? ""}
        subTitle={jobData?.job.itemReadableIdWithRevision ?? ""}
        notes={notes}
      />

      <Suspense
        fallback={
          <div className="flex w-full h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center min-h-[420px] max-h-[70vh]">
            <Spinner className="h-10 w-10" />
          </div>
        }
      >
        <Await resolve={jobData.files}>
          {(files) => (
            <JobDocuments
              files={files}
              jobId={jobData.job.id ?? ""}
              itemId={jobData.job.itemId}
              modelUpload={{ ...jobData.job }}
            />
          )}
        </Await>
      </Suspense>
      <Suspense>
        <Await resolve={purchaseOrderLines}>
          {(purchaseOrderLines) => (
            <JobPurchaseOrderLines
              purchaseOrderLines={purchaseOrderLines.data ?? []}
            />
          )}
        </Await>
      </Suspense>
      <CadModel
        isReadOnly={!permissions.can("update", "production")}
        metadata={{
          jobId: jobData?.job?.id ?? undefined,
          itemId: jobData?.job?.itemId ?? undefined,
        }}
        modelPath={jobData?.job?.modelPath ?? null}
        title="CAD Model"
        uploadClassName="aspect-square min-h-[420px] max-h-[70vh]"
        viewerClassName="aspect-square min-h-[420px] max-h-[70vh]"
      />
    </VStack>
  );
}

function JobPurchaseOrderLines({
  purchaseOrderLines,
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
