// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
