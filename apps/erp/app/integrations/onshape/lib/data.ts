import { z } from "zod";
import { itemReplenishmentSystems } from "~/modules/items/items.models";
import { methodType } from "~/modules/shared/shared.models";

export const onShapeDataValidator = z
  .object({
    id: z.string().optional(),
    index: z.string(),
    readableId: z.string().optional(),
    name: z.string(),
    quantity: z.number(),
    replenishmentSystem: z.enum(itemReplenishmentSystems),
    defaultMethodType: z.enum(methodType),
  })
  .array();
