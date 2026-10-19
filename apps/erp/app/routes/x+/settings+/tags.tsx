// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";

// Any taggable record's properties panel posts here: the record ids, its
// table and the tags, each id and tag repeated.
const tagsForm = z.object({
  ids: zfd.repeatable(z.array(z.string())),
  table: z.string().min(1),
  value: zfd.repeatable(z.array(z.string()))
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(tagsForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const { ids, table, value } = input.data;
  return api.settings.setRecordTags({ table, ids, tags: value });
}
