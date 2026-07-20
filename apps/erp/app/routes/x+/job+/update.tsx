import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import {
  calculateJobPriority,
  isJobLocked,
  recalculateJobRequirements,
  upsertJobMethod
} from "~/modules/production";
import { requireUnlockedBulk } from "~/utils/lockedGuard.server";

const logger = getLogger("erp", "update");

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids");
  const field = formData.get("field");
  const value = formData.get("value");

  if (typeof field !== "string") {
    return { error: { message: "Invalid form data" }, data: null };
  }

  // Per-ID locked check
  const jobs = await client
    .from("job")
    .select("id, status")
    .in("id", ids as string[]);

  const lockedError = requireUnlockedBulk({
    statuses: (jobs.data ?? []).map((j) => j.status),
    checkFn: isJobLocked,
    message: "Cannot modify a locked job. Reopen it first."
  });
  if (lockedError) return lockedError;

  const serviceRole = await getCarbonServiceRole();

  if (field === "delete") {
    return await client
      .from("job")
      .delete()
      .in("id", ids as string[])
      .eq("companyId", companyId);
  }
  if (typeof value !== "string" && value !== null) {
    return { error: { message: "Invalid form data" }, data: null };
  }

  switch (field) {
    case "itemId":
      if (!value) {
        return { error: { message: "Invalid form data" }, data: null };
      }

      const [item, manufacturing] = await Promise.all([
        client
          .from("item")
          .select(
            "name, readableIdWithRevision, defaultMethodType, unitOfMeasureCode, modelUploadId"
          )
          .eq("id", value)
          .eq("companyId", companyId)
          .single(),
        client
          .from("itemReplenishment")
          .select("lotSize, scrapPercentage")
          .eq("itemId", value)
          .single()
      ]);

      const [itemUpdate, makeMethodUpdate] = await Promise.all([
        client
          .from("job")
          .update({
            itemId: value,
            unitOfMeasureCode: item.data?.unitOfMeasureCode ?? "EA",
            quantity:
              (manufacturing?.data?.lotSize ?? 0) === 0
                ? undefined
                : (manufacturing?.data?.lotSize ?? 0),
            modelUploadId: item.data?.modelUploadId ?? null,
            scrapQuantity: Math.ceil(
              (manufacturing?.data?.lotSize ?? 0) *
                (manufacturing?.data?.scrapPercentage ?? 0)
            ),
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
          .in("id", ids as string[])
          .eq("companyId", companyId),

        client
          .from("jobMakeMethod")
          .update({
            itemId: value,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
          .in("jobId", ids as string[])
          .is("parentMaterialId", null)
          .eq("companyId", companyId)
      ]);

      if (itemUpdate.error) {
        return itemUpdate;
      }

      if (makeMethodUpdate.error) {
        return makeMethodUpdate;
      }

      for await (const id of ids) {
        const upsertMethod = await upsertJobMethod(serviceRole, "itemToJob", {
          sourceId: value,
          targetId: id as string,
          companyId,
          userId
        });

        if (upsertMethod.error) {
          upsertMethod.error;
        }

        await trigger("recalculate", {
          type: "jobRequirements",
          id: id as string,
          companyId,
          userId
        });
      }

      return itemUpdate;
    case "deadlineType":
    case "dueDate":
      // When dueDate or deadlineType changes, recalculate priority
      for await (const id of ids) {
        // Get the current job to access its data
        const currentJob = await client
          .from("job")
          .select("dueDate, deadlineType, locationId")
          .eq("id", id as string)
          .eq("companyId", companyId)
          .single();

        if (currentJob.error || !currentJob.data) {
          return currentJob;
        }

        // Determine the new dueDate and deadlineType after this update
        const newDueDate =
          field === "dueDate" ? (value ?? null) : currentJob.data.dueDate;
        const newDeadlineType =
          field === "deadlineType" ? value : currentJob.data.deadlineType;

        if (!newDeadlineType) {
          return {
            error: { message: "Invalid deadline type" },
            data: null
          };
        }

        // Calculate new priority
        const priority = await calculateJobPriority(client, {
          jobId: id as string,
          dueDate: newDueDate,
          deadlineType: newDeadlineType as
            | "ASAP"
            | "Hard Deadline"
            | "Soft Deadline"
            | "No Deadline",
          companyId,
          locationId: currentJob.data.locationId
        });

        // Update the job with new field value and priority
        const updateResult = await client
          .from("job")
          .update({
            [field]: value ? value : null,
            priority,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
          .eq("id", id as string)
          .eq("companyId", companyId);

        if (updateResult.error) {
          return updateResult;
        }
      }

      return { error: null, data: null };
    case "customerId":
    case "jobId":
    case "locationId":
    case "storageUnitId":
    case "startDate":
    case "unitOfMeasureCode":
      return await client
        .from("job")
        .update({
          [field]: value ? value : null,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[])
        .eq("companyId", companyId);
    case "quantity":
    case "scrapQuantity":
      const quantityUpdate = await client
        .from("job")
        .update({
          [field]: value ? value : null,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[])
        .eq("companyId", companyId);

      if (quantityUpdate.error) {
        return quantityUpdate;
      }

      for await (const id of ids) {
        const recalculate = await recalculateJobRequirements(serviceRole, {
          id: id as string,
          companyId,
          userId
        });
        if (recalculate.error) {
          logger.error(recalculate.error);
          return recalculate;
        }
      }

      return quantityUpdate;
    case "salesOrderId":
    case "salesOrderLineId":
      if (!value) {
        return await client
          .from("job")
          .update({ salesOrderId: null, salesOrderLineId: null })
          .in("id", ids as string[])
          .eq("companyId", companyId);
      } else {
        return {
          error: { message: `Invalid value: ${value} for field: ${field}` },
          data: null
        };
      }
    default:
      return {
        error: { message: `Invalid field: ${field}` },
        data: null
      };
  }
}
