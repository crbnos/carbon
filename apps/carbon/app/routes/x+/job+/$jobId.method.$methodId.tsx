import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import { json, redirect, useLoaderData, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  getJobMaterialsByMethodId,
  getJobOperationsByMethodId,
  JobBillOfMaterial,
  JobBillOfProcess,
} from "~/modules/production";
import JobBreadcrumbs from "~/modules/production/ui/Jobs/JobBreadcrumbs";
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

  return json({
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
  });
}

export default function JobMakeMethodRoute() {
  const { methodId } = useParams();
  if (!methodId) throw new Error("Could not find methodId");

  const loaderData = useLoaderData<typeof loader>();
  const { materials, operations } = loaderData;

  return (
    <VStack spacing={2} key={JSON.stringify(loaderData)} className="p-2">
      <JobBreadcrumbs />
      <JobBillOfProcess jobMakeMethodId={methodId} operations={operations} />
      <JobBillOfMaterial
        jobMakeMethodId={methodId}
        materials={materials}
        operations={operations}
      />
    </VStack>
  );
}
