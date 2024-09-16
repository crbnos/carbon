import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect, useLoaderData, useParams } from "@remix-run/react";

import {
  getJobMaterial,
  getJobOperationsByMethodId,
  JobMaterialForm,
} from "~/modules/production";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "production",
  });

  const { jobId, methodId, materialId } = params;
  if (!jobId) throw new Error("Could not find jobId");
  if (!methodId) throw new Error("Could not find methodId");
  if (!materialId) throw new Error("Could not find materialId");

  const [material, operations] = await Promise.all([
    getJobMaterial(client, materialId),
    getJobOperationsByMethodId(client, methodId),
  ]);

  if (material.error) {
    throw redirect(
      path.to.job(jobId),
      await flash(request, error(material.error, "Failed to load job material"))
    );
  }

  return json({
    material: {
      ...material.data,
      id: material.data.id ?? "",
      description: material.data.description ?? "",
      itemId: material.data.itemId ?? "",
      itemReadableId: material.data.itemReadableId ?? "",
      itemType: material.data.itemType as "Part",
      methodType: material.data.methodType ?? "Make",
      order: material.data.order ?? 1,
      quantity: material.data.quantity ?? 0,
      jobMakeMethodId: material.data.jobMakeMethodId ?? "",
      jobMaterialMakeMethodId: material.data.jobMaterialMakeMethodId,
      jobOperationId: material.data.jobOperationId ?? undefined,
      unitCost: material.data.unitCost ?? 0,
      unitOfMeasureCode: material.data.unitOfMeasureCode ?? "",
    },
    operations:
      operations.data?.map((o) => ({
        ...o,
        description: o.description ?? "",
        laborRate: o.laborRate ?? 0,
        machineRate: o.machineRate ?? 0,
        operationSupplierProcessId: o.operationSupplierProcessId ?? undefined,
        jobMakeMethodId: o.jobMakeMethodId ?? methodId,
        workCenterId: o.workCenterId ?? undefined,
      })) ?? [],
  });
}

export default function JobMaterialBuyPage() {
  const { material, operations } = useLoaderData<typeof loader>();

  const { materialId } = useParams();
  if (!materialId) throw new Error("Could not find materialId");

  return (
    <VStack spacing={2}>
      <JobMaterialForm
        key={materialId}
        initialValues={material}
        operations={operations}
      />
    </VStack>
  );
}
