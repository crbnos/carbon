// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import type { onShapeDataValidator } from "@carbon/ee/onshape";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";

// The Onshape panel's Sync: `rows` is the assembly's bill of materials as JSON.
const onshapeSyncForm = z.object({
  makeMethodId: z.string().min(1),
  documentId: z.string(),
  versionId: z.string(),
  elementId: z.string(),
  rows: zfd.json(z.unknown())
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(onshapeSyncForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const { rows, ...ids } = input.data;
  // The operation checks `rows` with its own schema; the panel toasts what is wrong.
  return api.items.syncOnshapeMethod({
    ...ids,
    rows: rows as z.input<typeof onShapeDataValidator>
  });
}
