// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { labelSizes } from "@carbon/utils";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { printerContexts } from "./assignments";
import { labelTemplateTypes } from "./registry";

export const manualPrintValidator = z.object({
  sourceDocument: z.string().min(1),
  sourceDocumentId: z.string().min(1),
  locationId: z.string().optional(),
  workCenterId: z.string().optional(),
  printerRouteId: z.string().optional()
});

export const printerRouteValidator = z.object({
  id: zfd.text(z.string().optional()),
  locationId: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  format: z.enum(["zpl", "pdf"]),
  mediaSizeId: z.string().min(1, { message: "Media size is required" }),
  printerUrl: z.string().url({ message: "Must be a valid URL" }),
  apiKey: zfd.text(z.string().optional())
});

export const labelTemplateValidator = z.object({
  id: zfd.text(z.string().optional()),
  labelType: z.enum(labelTemplateTypes),
  mediaSizeId: z.enum(
    labelSizes.map((size) => size.id) as [string, ...string[]]
  ),
  templateId: z.string().trim().min(1, { message: "Template ID is required" })
});

export const updateAssignmentValidator = z
  .object({
    locationId: z.string().min(1),
    context: z.enum(printerContexts),
    contextId: zfd.text(z.string().optional()),
    printerRouteId: zfd.text(z.string().optional()),
    autoPrint: zfd.checkbox()
  })
  .refine((data) => data.context !== "workCenter" || !!data.contextId, {
    message: "contextId is required for workCenter assignments",
    path: ["contextId"]
  });

export const reprintValidator = z.object({
  printJobId: z.string().min(1, { message: "Print job ID is required" }),
  printerUrl: zfd.text(z.string().optional())
});
