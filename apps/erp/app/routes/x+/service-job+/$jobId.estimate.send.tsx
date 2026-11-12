// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { getPreferenceHeaders } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { serviceJobEstimateSendFormValidator } from "~/modules/service/service.models";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(serviceJobEstimateSendFormValidator).request(
    args,
    { params: ["jobId"] }
  );
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  // A failed email does not undo the send: the modal shows `warning`.
  return api.service.sendServiceJobEstimate({
    ...input.data,
    jobId: input.params.jobId,
    locale: getPreferenceHeaders(args.request).locale
  });
}
