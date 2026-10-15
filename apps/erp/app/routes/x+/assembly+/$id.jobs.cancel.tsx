// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { carbon } from "~/modules/carbon.server";

const cancelForm = z.object({ kind: z.enum(["convert", "plan"]) });

export async function action(args: ActionFunctionArgs) {
  const input = await validator(cancelForm).request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.production.assembly.cancelJob({
    id: input.params.id,
    kind: input.data.kind
  });
}
