// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { z } from "zod";

const methodType = [
  "Purchase to Order",
  "Make to Order",
  "Pull from Inventory"
] as const;
const replenishmentSystems = ["Buy", "Make", "Buy and Make"] as const;

export const onShapeDataValidator = z
  .object({
    id: z.string().optional(),
    index: z.string(),
    readableId: z.string().optional(),
    revision: z.string().optional(),
    name: z.string(),
    quantity: z.number(),
    replenishmentSystem: z.enum(replenishmentSystems),
    defaultMethodType: z.enum(methodType),
    data: z.record(z.string(), z.any())
  })
  .array();
