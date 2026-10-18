// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { CarbonError, toResult } from "@carbon/api/service-fn.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import type { deadlineTypes } from "~/modules/production/production.models";

// The jobs table's bulk actions and the job properties panel: one field of
// one or more jobs per post.
const updateForm = z.object({
  ids: zfd.repeatableOfType(z.string()),
  field: z.enum([
    "delete",
    "itemId",
    "deadlineType",
    "dueDate",
    "quantity",
    "scrapQuantity",
    "salesOrderId",
    "salesOrderLineId",
    "customerId",
    "jobId",
    "locationId",
    "storageUnitId",
    "startDate",
    "unitOfMeasureCode"
  ]),
  value: zfd.text(z.string().optional())
});

const invalid = (message: string) =>
  toResult({ data: null, error: new CarbonError("validation", message) });

export async function action(args: ActionFunctionArgs) {
  const input = await validator(updateForm).request(args);
  if ("invalid" in input) return input.invalid;
  const { ids, field, value } = input.data;
  const job = (await carbon(args.request)).production;

  switch (field) {
    case "delete":
      return job.deleteJobs({ ids });
    case "itemId":
      if (!value) return invalid("Invalid form data");
      return job.setJobItem({ ids, itemId: value });
    case "dueDate":
      return job.setJobDeadline({ ids, dueDate: value ?? null });
    case "deadlineType":
      return job.setJobDeadline({
        ids,
        deadlineType: value as (typeof deadlineTypes)[number]
      });
    case "quantity":
    case "scrapQuantity":
      return job.setJobQuantity({ ids, [field]: Number(value) });
    case "salesOrderId":
      // Linking goes through the line; the order alone can only be cleared.
      if (value) return invalid(`Invalid value: ${value} for field: ${field}`);
      return job.setJobSalesOrderLine({ ids, salesOrderLineId: null });
    case "salesOrderLineId":
      return job.setJobSalesOrderLine({ ids, salesOrderLineId: value ?? null });
    default:
      return job.setJobFields({ ids, [field]: value ?? null });
  }
}
