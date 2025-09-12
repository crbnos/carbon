import { badRequest, getCarbonServiceRole, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import type { recalculateTask } from "@carbon/jobs/trigger/recalculate";
import { getLocalTimeZone, today } from "@internationalized/date";
import { FunctionRegion, type SupabaseClient } from "@supabase/supabase-js";
import { tasks } from "@trigger.dev/sdk/v3";
import { redirect, type LoaderFunctionArgs } from "@vercel/remix";

import type { Kanban } from "~/modules/inventory";
import { getKanban } from "~/modules/inventory";
import { getItemReplenishment } from "~/modules/items";
import { runMRP, upsertJob, upsertJobMethod } from "~/modules/production";
import {
  upsertPurchaseOrder,
  upsertPurchaseOrderLine,
} from "~/modules/purchasing";
import { getNextSequence } from "~/modules/settings";
import { path } from "~/utils/path";

async function createJob({
  client,
  args,
}: {
  client: SupabaseClient<Database>;
  args: {
    kanban: Kanban;
    companyId: string;
    userId: string;
  };
}): Promise<string | null> {
  const { companyId, userId, kanban } = args;
  if (!kanban.itemId) return null;

  const [nextSequence, manufacturing] = await Promise.all([
    getNextSequence(client, "job", companyId),
    getItemReplenishment(client, kanban.itemId!, companyId),
  ]);
  if (nextSequence.error) {
    console.error(nextSequence.error);
    return null;
  }
  let jobId = nextSequence.data;
  let leadTime = manufacturing.data?.leadTime ?? 7;

  const startDate = today(getLocalTimeZone());
  const dueDate = startDate.add({ days: leadTime }).toString();

  if (!jobId) {
    console.error("Failed to get next job id");
    return null;
  }

  const createJob = await upsertJob(client, {
    jobId,
    itemId: kanban.itemId!,
    quantity: kanban.quantity!,
    locationId: kanban.locationId!,
    unitOfMeasureCode: kanban.purchaseUnitOfMeasureCode!,
    deadlineType: "Hard Deadline",
    scrapQuantity: 0,
    startDate: startDate.toString(),
    dueDate,
    companyId,
    createdBy: userId,
  });

  const id = createJob.data?.id!;
  if (createJob.error || !jobId) {
    console.error(createJob.error);
    return null;
  }

  const upsertMethod = await upsertJobMethod(
    getCarbonServiceRole(),
    "itemToJob",
    {
      sourceId: kanban.itemId!,
      targetId: id,
      companyId,
      userId,
      configuration: undefined,
    }
  );

  if (upsertMethod.error) {
    console.error(upsertMethod.error);
    return id;
  }

  if (kanban.autoRelease) {
    const serviceRole = getCarbonServiceRole();
    await Promise.all([
      tasks.trigger<typeof recalculateTask>("recalculate", {
        type: "jobRequirements",
        id,
        companyId,
        userId,
      }),
      runMRP(serviceRole, {
        type: "job",
        id,
        companyId,
        userId,
      }),
      serviceRole.functions.invoke("scheduler", {
        body: {
          type: "schedule",
          jobId: id,
          companyId,
          userId,
        },
        region: FunctionRegion.UsEast1,
      }),
      serviceRole
        .from("job")
        .update({
          status: "Ready",
        })
        .eq("id", jobId),
    ]);
  }

  return id;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw notFound("id not found");

  const kanban = await getKanban(client, id);

  if (kanban.error || !kanban.data) {
    throw notFound("Kanban is not active");
  }

  if (kanban.data.companyId !== companyId) {
    throw notFound("Kanban is not active");
  }

  if (kanban.data.replenishmentSystem === "Make") {
    const jobId = await createJob({
      client,
      args: {
        kanban: kanban.data,
        companyId,
        userId,
      },
    });

    if (jobId) {
      const jobMakeMethod = await client
        .from("jobMakeMethod")
        .select("id")
        .eq("jobId", jobId)
        .is("parentMaterialId", null)
        .eq("companyId", companyId)
        .maybeSingle();

      if (jobMakeMethod.data && kanban.data.autoRelease) {
        throw redirect(path.to.file.jobTraveler(jobMakeMethod.data.id));
      }

      throw redirect(path.to.job(jobId));
    } else {
      throw badRequest("Failed to create job");
    }
  } else if (kanban.data.replenishmentSystem === "Buy") {
    // Check for existing purchase order
    const existingPurchaseOrder = await client
      .from("purchaseOrder")
      .select("id")
      .eq("supplierId", kanban.data.supplierId!)
      .in("status", ["Planned", "Draft"])
      .eq("companyId", companyId)
      .maybeSingle();

    let purchaseOrderId = existingPurchaseOrder.data?.id;

    // Create purchase order if it doesn't exist
    if (!purchaseOrderId) {
      const nextSequence = await getNextSequence(
        client,
        "purchaseOrder",
        companyId
      );
      if (nextSequence.error) {
        throw badRequest("Failed to get next purchase order sequence");
      }

      const newPurchaseOrder = await upsertPurchaseOrder(client, {
        purchaseOrderId: nextSequence.data!,
        supplierId: kanban.data.supplierId!,
        status: "Draft",
        purchaseOrderType: "Purchase",
        companyId,
        createdBy: userId,
      });

      if (newPurchaseOrder.error || !newPurchaseOrder.data?.[0]) {
        throw badRequest("Failed to create purchase order");
      }

      purchaseOrderId = newPurchaseOrder.data[0].id;
    }

    const [item, supplierPart, inventory] = await Promise.all([
      client
        .from("item")
        .select(
          "name, readableIdWithRevision, type, unitOfMeasureCode, itemCost(unitCost), itemReplenishment(purchasingUnitOfMeasureCode, conversionFactor, leadTime)"
        )
        .eq("id", kanban.data.itemId!)
        .eq("companyId", companyId)
        .single(),
      client
        .from("supplierPart")
        .select("*")
        .eq("itemId", kanban.data.itemId!)
        .eq("companyId", companyId)
        .eq("supplierId", kanban.data.supplierId!)
        .maybeSingle(),
      client
        .from("pickMethod")
        .select("defaultShelfId")
        .eq("itemId", kanban.data.itemId!)
        .eq("companyId", companyId)
        .eq("locationId", kanban.data.locationId!)
        .maybeSingle(),
    ]);

    const itemCost = item?.data?.itemCost?.[0];
    const itemReplenishment = item?.data?.itemReplenishment;

    if (item.error) {
      console.error(item.error);
      throw badRequest("Failed to get item");
    }

    // Add purchase order line
    const createPurchaseOrderLine = await upsertPurchaseOrderLine(client, {
      purchaseOrderId: purchaseOrderId!,
      // @ts-expect-error
      purchaseOrderLineType: item.data?.type,
      itemId: kanban.data.itemId!,
      purchaseQuantity: kanban.data.quantity!,
      supplierUnitPrice:
        supplierPart?.data?.unitPrice ?? itemCost?.unitCost ?? 0,
      supplierShippingCost: 0,
      supplierTaxAmount: 0,
      exchangeRate: 1,
      setupPrice: 0,
      purchaseUnitOfMeasureCode: kanban.data.purchaseUnitOfMeasureCode!,
      inventoryUnitOfMeasureCode:
        item.data?.unitOfMeasureCode || kanban.data.purchaseUnitOfMeasureCode!,
      conversionFactor:
        kanban.data.conversionFactor ||
        itemReplenishment?.conversionFactor ||
        1,
      locationId: kanban.data.locationId!,
      shelfId:
        kanban.data.shelfId || inventory.data?.defaultShelfId || undefined,
      companyId,
      createdBy: userId,
    });

    if (createPurchaseOrderLine.error) {
      console.error(createPurchaseOrderLine.error);
      throw badRequest("Failed to create purchase order line");
    }

    throw redirect(path.to.purchaseOrder(purchaseOrderId!));
  } else {
    throw badRequest(`${kanban.data.replenishmentSystem} is not supported`);
  }
}
