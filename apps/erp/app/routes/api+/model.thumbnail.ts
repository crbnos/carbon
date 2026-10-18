// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { modelViewDirection } from "~/modules/documents/documents.models";

// Backs the item thumbnail's Regenerate and the viewer's capture from the
// current camera (`direction`, a JSON `[x, y, z]`).
const thumbnailForm = z.object({
  modelUploadId: z.string().min(1),
  direction: zfd.json(modelViewDirection.optional())
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(thumbnailForm).request(args);
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request);
  return api.documents.regenerateModelThumbnail(input.data);
}
