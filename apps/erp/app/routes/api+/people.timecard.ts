// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";

const ownTimecardForm = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("clockIn") }),
  z.object({
    intent: z.literal("clockOut"),
    clockOut: zfd.text(z.string().optional()),
    note: zfd.text(z.string().optional())
  })
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(ownTimecardForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const form = input.data;
  return form.intent === "clockIn"
    ? api.people.clockInSelf({})
    : api.people.clockOutSelf({
        clockOut: form.clockOut,
        note: form.note
      });
}
