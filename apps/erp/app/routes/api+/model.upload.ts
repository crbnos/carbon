// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";

const modelUploadForm = z.object({
  modelId: z.string().min(1, { message: "File ID is required" }),
  name: z.string().min(1, { message: "Name is required" }),
  modelPath: z.string().min(1, { message: "Model path is required" }),
  size: zfd.numeric(),
  convert: zfd.checkbox({ trueValue: "true" }),
  itemId: zfd.text(z.string().optional()),
  salesRfqLineId: zfd.text(z.string().optional()),
  quoteLineId: zfd.text(z.string().optional()),
  salesOrderLineId: zfd.text(z.string().optional()),
  jobId: zfd.text(z.string().optional())
});

// The browser's second step after it has staged the file. API callers use the
// `items_createModelUploadUrl` + `items_insertModelUpload` tools: the same
// operation.
export async function action(args: ActionFunctionArgs) {
  // Authenticate before the multipart body is read.
  const api = await carbon(args.request);
  const input = await validator(modelUploadForm).request(args);
  if ("invalid" in input) return input.invalid;
  const { modelPath, ...rest } = input.data;
  return api.items.insertModelUpload({ ...rest, path: modelPath });
}
