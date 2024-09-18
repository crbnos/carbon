import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect, useLoaderData, useParams } from "@remix-run/react";

import {
  getJobMaterial,
  getJobMaterialsByMethodId,
  getJobOperationsByMethodId,
  JobBillOfMaterial,
  JobBillOfProcess,
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

  const [material, materials, operations] = await Promise.all([
    getJobMaterial(client, materialId),
    getJobMaterialsByMethodId(client, methodId),
    getJobOperationsByMethodId(client, methodId),
  ]);

  if (material.error) {
    throw redirect(
      path.to.job(jobId),
      await flash(request, error(material.error, "Failed to load job material"))
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
        workInstruction: o.workInstruction as JSONContent | null,
      })) ?? [],
  });
}

export default function JobMakeMethodRoute() {
  const { methodId } = useParams();
  if (!methodId) throw new Error("Could not find methodId");

  const { material, materials, operations } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={2}>
      <JobMaterialForm
        key={JSON.stringify(material)}
        initialValues={material}
        operations={operations}
      />
      <JobBillOfProcess
        key={JSON.stringify(operations)}
        jobMakeMethodId={methodId}
        operations={operations}
      />
      <JobBillOfMaterial
        key={JSON.stringify(materials)}
        jobMakeMethodId={methodId}
        materials={materials}
        operations={operations}
      />
    </VStack>
  );
}
