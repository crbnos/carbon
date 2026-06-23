import { z } from "zod";
import { jobOperationStatus } from "~/modules/production";
import { operationTypes } from "~/modules/shared";

export const jobOperationValidator = z
  .object({
    id: z.string(),
    status: z.enum(jobOperationStatus),
    description: z.string(),
    order: z.number(),
    operationType: z.enum(operationTypes),
    operationQuantity: z.number(),
    quantityComplete: z.number()
  })
  .array();
