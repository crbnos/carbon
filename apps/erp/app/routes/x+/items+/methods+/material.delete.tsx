// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";

// One `id` per material, so the bill of material's Delete Selected is one
// request.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(
    z.object({ id: zfd.repeatable(z.array(z.string().min(1)).min(1)) })
  ).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.items.deleteMethodMaterials({ ids: input.data.id });
  if (result.data?.notice) {
    return data(result, await flash(args.request, success(result.data.notice)));
  }
  return result;
}
