// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";

// The viewer's spinner Cancel.
const cancelForm = z.object({ modelUploadId: z.string().min(1) });

export async function action(args: ActionFunctionArgs) {
  const input = await validator(cancelForm).request(args);
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request);
  return api.documents.cancelModelOptimize(input.data);
}
