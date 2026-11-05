// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate, formatFactor } from "@carbon/utils";
import type { MergeToken, RowVars } from "../../../template";
import { str } from "../textVars";
import type {
  JobOperationStep,
  JobOperationWithSteps,
  JobTravelerData,
  JobTravelerMaterial
} from "./types";

/** Merge-field variable map for a Job Traveler. */
export function buildJobTravelerVars(
  data: Pick<
    JobTravelerData,
    | "job"
    | "item"
    | "customer"
    | "company"
    | "jobOperations"
    | "batchNumber"
    | "methodRevision"
    | "locale"
  >
): Record<MergeToken<"jobTraveler">, string> {
  const { job, item, customer, company, methodRevision, locale } = data;

  return {
    "job.number": str(job?.jobId),
    "job.startDate": formatDate(job?.startDate, undefined, locale),
    "job.dueDate": formatDate(job?.dueDate, undefined, locale),
    "job.deadlineType": str(job?.deadlineType),
    "job.quantity": str(
      data.jobOperations?.[0]?.targetQuantity ?? job?.quantity
    ),
    "job.scrapQuantity": str(job?.scrapQuantity),
    "job.unit": str(job?.unitOfMeasureCode),
    "job.salesOrder": str(job?.salesOrderReadableId),
    // Revision 0 is the method's first version, which prints no revision.
    "job.methodRevision":
      methodRevision && methodRevision !== "0" ? methodRevision : "",
    "job.batchNumber": str(data.batchNumber),
    "item.readableId": str(
      job?.itemReadableIdWithRevision ?? item?.readableIdWithRevision
    ),
    "item.name": str(item?.name),
    "item.trackingType": str(item?.itemTrackingType),
    "customer.name": str(customer?.name),
    "company.name": str(company?.name),
    "company.city": str(company?.city),
    "company.country": str(company?.countryCode)
  };
}

/**
 * The sequence number printed for an operation. One that runs With Previous
 * shares the number of the operation it runs with.
 */
function getParallelizedOrder(
  index: number,
  item: JobOperationWithSteps,
  items: JobOperationWithSteps[]
) {
  if (item?.operationOrder !== "With Previous") return index + 1;
  // traverse backwards to find the first non-"With Previous" item.
  for (let i = index - 1; i >= 0; i--) {
    if (items[i]?.operationOrder !== "With Previous") {
      return i + 1;
    }
  }
  return 1;
}

export function buildJobTravelerOperationVars(
  operation: JobOperationWithSteps,
  rowNumber: number,
  data: Pick<JobTravelerData, "jobOperations">
): RowVars<"jobTraveler", "operation"> {
  return {
    "operation.seq": String(
      getParallelizedOrder(rowNumber - 1, operation, data.jobOperations)
    ),
    "operation.description": str(operation.description),
    "operation.setupTime": formatFactor(
      operation.setupTime,
      operation.setupUnit
    ),
    "operation.laborTime": formatFactor(
      operation.laborTime,
      operation.laborUnit
    ),
    "operation.machineTime": formatFactor(
      operation.machineTime,
      operation.machineUnit
    ),
    "operation.batch": str(operation.jobOperationBatch?.readableId)
  };
}

export function buildJobTravelerStepVars(
  step: JobOperationStep
): RowVars<"jobTraveler", "step"> {
  return { "step.name": str(step.name) };
}

export function buildJobTravelerMaterialVars(
  material: JobTravelerMaterial
): RowVars<"jobTraveler", "material"> {
  return {
    "material.itemId": str(material.itemReadableId),
    "material.description": str(material.description),
    "material.quantity": str(material.quantity),
    "material.unit": str(material.unitOfMeasureCode)
  };
}
